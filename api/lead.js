// Vercel serverless function — receives a website lead and creates it in Rotor CRM.
//
// SETUP (one time):
//   1. In Rotor: Integrations → generate an API key (Enterprise plan). It looks like
//      rotor_<keyId>_<keySecret>.
//   2. In Vercel: Project → Settings → Environment Variables → add
//      ROTOR_API_KEY = the full key above  (for Production + Preview).
//   3. Redeploy.
//
// Until ROTOR_API_KEY is set, this falls back to Formspree so no lead is ever lost.
// The Rotor API must be called server-side only (the key must never reach the browser),
// which is exactly what this function is for.

const ROTOR_ENDPOINT = 'https://api.getrotor.com/open-api/leads';
const FORMSPREE_ENDPOINT = 'https://formspree.io/f/meenyplk'; // fallback email during setup

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  // Vercel parses JSON bodies automatically; guard just in case.
  const data = (req.body && typeof req.body === 'object') ? req.body : safeParse(req.body);
  const name = String(data.name || '').trim();
  if (!name) {
    res.status(400).json({ ok: false, error: 'Name is required' });
    return;
  }

  const isExact = /exact quote/i.test(String(data.request_type || ''));

  const lead = {
    name,
    phone: data.phone || undefined,
    email: data.email || undefined,
    address_street1: data.address || undefined,
    address_city: data.city || undefined,
    address_state: 'BC',
    address_country: 'Canada',
    source: data.source || 'Website — Instant Quote',
    service_type: 'Permanent LED Lighting',
    priority: isExact ? 'high' : 'medium',
    tags: ['website', isExact ? 'exact-quote' : 'instant-estimate'],
    notes: [
      data.home_size && `Home: ${data.home_size}`,
      data.areas && `Areas: ${data.areas}`,
      data.usage && `Usage: ${data.usage}`,
      data.goals && `Goals: ${data.goals}`,
      data.timing && `Timing: ${data.timing}`,
      data.estimate_range && `Estimate: ${data.estimate_range}`,
      data.model_home_eligible && `Model home: ${data.model_home_eligible}`,
      data.request_type && `Request: ${data.request_type}`,
    ].filter(Boolean).join('\n') || undefined,
  };

  const ROTOR_KEY = process.env.ROTOR_API_KEY;

  // No key configured yet → keep leads flowing via Formspree.
  if (!ROTOR_KEY) {
    await sendFormspree(data);
    res.status(200).json({ ok: true, crm: 'formspree-fallback' });
    return;
  }

  try {
    const r = await fetch(ROTOR_ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': ROTOR_KEY,
        'rotor-api-version': '1.1.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(lead),
    });

    if (r.ok) {
      res.status(200).json({ ok: true, crm: 'rotor', status: r.status });
      return;
    }

    // Rotor rejected it — don't drop the lead, email it via Formspree as a backstop.
    const detail = (await r.text()).slice(0, 500);
    await sendFormspree(data);
    res.status(200).json({ ok: true, crm: 'formspree-fallback', rotorError: r.status, detail });
  } catch (err) {
    await sendFormspree(data).catch(() => {});
    res.status(200).json({ ok: true, crm: 'formspree-fallback', note: 'rotor request failed' });
  }
};

async function sendFormspree(data) {
  await fetch(FORMSPREE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(data),
  });
}

function safeParse(body) {
  try { return JSON.parse(body || '{}'); } catch { return {}; }
}
