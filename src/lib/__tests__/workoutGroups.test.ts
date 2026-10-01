import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GROUP_COLOR, GROUP_SHORT, TRAINING_GROUPS, groupCounts, workoutGroups } from '../training';

describe('workoutGroups', () => {
  it('reads the groups off the tags', () => {
    assert.deepEqual(workoutGroups({ tags: ['Legs', 'Core'] }), ['Legs', 'Core']);
  });

  it('reads a session named for its group, even when it was never tagged', () => {
    assert.deepEqual(workoutGroups({ name: 'Legs' }), ['Legs']);
  });

  it('finds the group inside a longer name', () => {
    assert.deepEqual(workoutGroups({ name: 'Leg day' }), []);
    assert.deepEqual(workoutGroups({ name: 'Legs day' }), ['Legs']);
    assert.deepEqual(workoutGroups({ name: 'Arms + Shoulders' }), ['Arms', 'Shoulders']);
  });

  it('does not invent a group for a name that states none', () => {
    assert.deepEqual(workoutGroups({ name: 'Push day' }), []);
    assert.deepEqual(workoutGroups({}), []);
  });

  it('ignores case', () => {
    assert.deepEqual(workoutGroups({ name: 'legs' }), ['Legs']);
    assert.deepEqual(workoutGroups({ tags: ['BACK'] }), ['Back']);
  });

  it('lists each group once when the name repeats a tag', () => {
    assert.deepEqual(workoutGroups({ name: 'Legs', tags: ['Legs'] }), ['Legs']);
  });

  it('puts tags first, since they are the deliberate answer', () => {
    assert.deepEqual(workoutGroups({ name: 'Chest', tags: ['Back'] }), ['Back', 'Chest']);
  });
});

describe('groupCounts', () => {
  it('counts sessions per group', () => {
    const counts = groupCounts([
      { name: 'Legs' },
      { name: 'Legs' },
      { name: 'Back' },
      { name: 'Push day' },
    ]);
    assert.equal(counts.get('Legs'), 2);
    assert.equal(counts.get('Back'), 1);
    assert.equal(counts.get('Chest'), undefined);
  });

  it('counts a session that covers two groups under both', () => {
    const counts = groupCounts([{ tags: ['Arms', 'Shoulders'] }]);
    assert.equal(counts.get('Arms'), 1);
    assert.equal(counts.get('Shoulders'), 1);
  });

  it('is empty for no sessions', () => {
    assert.equal(groupCounts([]).size, 0);
  });
});

describe('group presentation', () => {
  it('gives every group a colour and a short form', () => {
    for (const group of TRAINING_GROUPS) {
      assert.ok(GROUP_COLOR[group], `${group} has no colour`);
      assert.ok(GROUP_SHORT[group], `${group} has no short form`);
    }
  });

  it('never repeats a hue, so two groups cannot look like one', () => {
    const used = TRAINING_GROUPS.map((g) => GROUP_COLOR[g]);
    assert.equal(new Set(used).size, used.length);
  });

  it('keeps short forms short enough for a calendar cell', () => {
    for (const group of TRAINING_GROUPS) {
      assert.ok(GROUP_SHORT[group].length <= 6, `${GROUP_SHORT[group]} is too long`);
    }
  });
});
