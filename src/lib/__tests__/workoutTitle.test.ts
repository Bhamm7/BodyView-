import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TRAINING_TAGS, workoutTitle } from '../training';

describe('workoutTitle', () => {
  it('uses the name when there is one', () => {
    assert.equal(workoutTitle({ name: 'Push day' }), 'Push day');
  });

  it('falls back to the tags when the session was never named', () => {
    assert.equal(workoutTitle({ name: '', tags: ['Chest', 'Arms'] }), 'Chest · Arms');
    assert.equal(workoutTitle({ tags: ['Legs'] }), 'Legs');
  });

  it('prefers the name over the tags', () => {
    assert.equal(workoutTitle({ name: 'Upper A', tags: ['Chest'] }), 'Upper A');
  });

  it('ignores a name that is only whitespace', () => {
    assert.equal(workoutTitle({ name: '   ', tags: ['Back'] }), 'Back');
  });

  it('falls back again when there is nothing at all', () => {
    assert.equal(workoutTitle({}), 'Workout');
    assert.equal(workoutTitle({ name: '  ', tags: [] }), 'Workout');
  });
});

describe('TRAINING_TAGS', () => {
  it('covers the muscle groups a session is split by', () => {
    for (const tag of ['Chest', 'Back', 'Legs', 'Arms', 'Shoulders', 'Core', 'Cardio']) {
      assert.ok(TRAINING_TAGS.includes(tag as never), `missing ${tag}`);
    }
  });

  it('has no duplicates', () => {
    assert.equal(new Set(TRAINING_TAGS).size, TRAINING_TAGS.length);
  });

  it('stays short enough to tap through at a glance', () => {
    assert.ok(TRAINING_TAGS.length <= 8, `${TRAINING_TAGS.length} tags is too many to scan`);
  });
});
