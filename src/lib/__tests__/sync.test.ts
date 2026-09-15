import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeServerUrl } from '../sync';

describe('normalizeServerUrl', () => {
  it('keeps an explicit scheme', () => {
    assert.equal(normalizeServerUrl('https://mini.tailnet.ts.net'), 'https://mini.tailnet.ts.net');
    assert.equal(normalizeServerUrl('http://mini.local:8787'), 'http://mini.local:8787');
  });

  it('assumes the page scheme for a bare host', () => {
    // Served over a tunnel: a bare host is HTTPS.
    assert.equal(normalizeServerUrl('mini.tailnet.ts.net', 'https'), 'https://mini.tailnet.ts.net');
    // Served on a home network: assuming HTTPS would fail to connect.
    assert.equal(normalizeServerUrl('mini.local:8787', 'http'), 'http://mini.local:8787');
    assert.equal(normalizeServerUrl('192.168.1.40:8787', 'http'), 'http://192.168.1.40:8787');
  });

  it('strips trailing slashes', () => {
    assert.equal(normalizeServerUrl('https://mini.ts.net/'), 'https://mini.ts.net');
    assert.equal(normalizeServerUrl('https://mini.ts.net///'), 'https://mini.ts.net');
  });

  it('keeps a subpath but drops a bare root', () => {
    assert.equal(normalizeServerUrl('https://example.com/bodyview'), 'https://example.com/bodyview');
    assert.equal(normalizeServerUrl('https://example.com/'), 'https://example.com');
  });

  it('preserves a non-default port', () => {
    assert.equal(normalizeServerUrl('http://10.0.0.5:8787', 'http'), 'http://10.0.0.5:8787');
  });

  it('ignores surrounding whitespace', () => {
    assert.equal(normalizeServerUrl('  https://mini.ts.net  '), 'https://mini.ts.net');
  });

  it('returns empty for input it cannot use', () => {
    assert.equal(normalizeServerUrl(''), '');
    assert.equal(normalizeServerUrl('   '), '');
    assert.equal(normalizeServerUrl('http://', 'http'), '');
    assert.equal(normalizeServerUrl('https://'), '');
  });
});
