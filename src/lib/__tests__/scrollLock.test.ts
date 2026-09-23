import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { lockScroll, resetScrollLocks } from '../scrollLock';

const target = () => ({ style: { overflow: '' } });

beforeEach(resetScrollLocks);

describe('lockScroll', () => {
  it('locks and restores what was there before', () => {
    const body = target();
    body.style.overflow = 'auto';
    const release = lockScroll(body);
    assert.equal(body.style.overflow, 'hidden');
    release();
    assert.equal(body.style.overflow, 'auto');
  });

  it('stays locked while a nested sheet is open, and frees on the last release', () => {
    const body = target();
    const outer = lockScroll(body);
    const inner = lockScroll(body);
    assert.equal(body.style.overflow, 'hidden');

    inner();
    assert.equal(body.style.overflow, 'hidden', 'the outer sheet is still open');

    outer();
    assert.equal(body.style.overflow, '', 'the page scrolls again');
  });

  it('frees the page whichever order the sheets unmount in', () => {
    const body = target();
    const outer = lockScroll(body);
    const inner = lockScroll(body);
    outer();
    inner();
    assert.equal(body.style.overflow, '');
  });

  it('ignores a release called twice', () => {
    const body = target();
    const outer = lockScroll(body);
    const inner = lockScroll(body);
    inner();
    inner();
    assert.equal(body.style.overflow, 'hidden', 'the outer lock survived the double release');
    outer();
    assert.equal(body.style.overflow, '');
  });

  it('captures the value in place at the first lock, not at a later one', () => {
    const body = target();
    body.style.overflow = 'scroll';
    const outer = lockScroll(body);
    const inner = lockScroll(body);
    inner();
    outer();
    assert.equal(body.style.overflow, 'scroll');
  });
});
