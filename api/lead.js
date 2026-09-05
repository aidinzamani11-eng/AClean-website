// Vercel serverless function — receives a website lead and creates it in Rotor CRM.
//
// SETUP (one time):
//   1. In Rotor: Integrations → create an API key with the "Create Leads" scope
//      (looks like rotor_<keyId>_<keySecret>).
//   2. In Vercel: Project → Settings → Environment Variables → add
//      ROTOR_API_KEY = the full key above (Production + Preview) → redeploy.
//
// The Rotor API must be called server-side only (the key must never reach the
// browser), which is exactly what this function is for. All website lead forms
// POST here; this forwards them into Rotor.

const ROTOR_ENDPOINT = 'https://api.getrotor.com/open-api/leads';

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

  const ROTOR_KEY = process.env.ROTOR_API_KEY;
  if (!ROTOR_KEY) {
    res.status(500).json({ ok: false, error: 'ROTOR_API_KEY is not configured' });
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
    source: data.source || 'Website',
    service_type: data.service_type || 'Permanent LED Lighting',
    priority: isExact ? 'high' : 'medium',
    tags: ['website'].concat(
      isExact ? ['exact-quote'] : (data.request_type ? ['instant-estimate'] : []),
      Array.isArray(data.tags) ? data.tags : []
    ),
    notes: [
      data.home_size && `Home: ${data.home_size}`,
      data.services && `Services: ${data.services}`,
      data.areas && `Areas: ${data.areas}`,
      data.usage && `Usage: ${data.usage}`,
      data.goals && `Goals: ${data.goals}`,
      data.timing && `Timing: ${data.timing}`,
      data.estimate_range && `Estimate: ${data.estimate_range}`,
      data.model_home_eligible && `Model home: ${data.model_home_eligible}`,
      data.message && `Message: ${data.message}`,
      data.request_type && `Request: ${data.request_type}`,
    ].filter(Boolean).join('\n') || undefined,
  };

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

    const detail = (await r.text()).slice(0, 500);
    res.status(502).json({ ok: false, error: 'Rotor rejected the lead', rotorStatus: r.status, detail });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Rotor request failed', detail: String(err).slice(0, 300) });
  }
};

function safeParse(body) {
  try { return JSON.parse(body || '{}'); } catch { return {}; }
}
