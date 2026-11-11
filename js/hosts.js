// Which hosts run test builds: the test tools, the Test build line and
// self-updating service workers appear only there.
// tavela-test.marsh.city hosts the public test build on its own origin, so
// nothing else on marsh.city shares its storage (ACCEPTANCE "Test build on its
// own subdomain"). Exact names only, so look-alike hosts never count.
const DEV_HOSTS = new Set(['127.0.0.1', 'localhost', 'tavela-test.marsh.city']);

export function isDevHost(hostname) {
  return DEV_HOSTS.has(hostname) || hostname.endsWith('.ts.net');
}
