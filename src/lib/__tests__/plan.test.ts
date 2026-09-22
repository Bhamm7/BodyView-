import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TrainingPlan, WorkoutTemplate } from '@/db/types';
import { advanced, planSummary, plannedTemplateId, upcomingTemplateIds } from '../plan';

const MONDAY = '2026-01-05';
const TUESDAY = '2026-01-06';

const weekday = (over: Partial<TrainingPlan> = {}): TrainingPlan => ({
  id: 'plan-1',
  name: 'Winter block',
  kind: 'weekday',
  days: [
    { day: 1, templateId: 'chest-a' },
    { day: 4, templateId: 'chest-b' },
  ],
  active: true,
  ...over,
});

const rotation = (over: Partial<TrainingPlan> = {}): TrainingPlan => ({
  id: 'plan-2',
  name: 'Push pull legs',
  kind: 'rotation',
  rotation: ['push', 'pull', 'legs'],
  position: 0,
  active: true,
  ...over,
});

const templates = new Map<string, WorkoutTemplate>([
  ['chest-a', { id: 'chest-a', name: 'Chest day A', items: [] }],
  ['chest-b', { id: 'chest-b', name: 'Chest day B', items: [] }],
  ['push', { id: 'push', name: 'Push', items: [] }],
  ['pull', { id: 'pull', name: 'Pull', items: [] }],
  ['legs', { id: 'legs', name: 'Legs', items: [] }],
]);

describe('plannedTemplateId', () => {
  it('reads a weekday plan off the calendar', () => {
    assert.equal(plannedTemplateId(weekday(), MONDAY), 'chest-a');
  });

  it('treats an unassigned weekday as rest', () => {
    assert.equal(plannedTemplateId(weekday(), TUESDAY), null);
  });

  it('ignores an inactive plan', () => {
    assert.equal(plannedTemplateId(weekday({ active: false }), MONDAY), null);
  });

  it('answers a rotation from its position, whatever the date', () => {
    const plan = rotation({ position: 1 });
    assert.equal(plannedTemplateId(plan, MONDAY), 'pull');
    assert.equal(plannedTemplateId(plan, TUESDAY), 'pull');
  });

  it('wraps a rotation position past the end', () => {
    assert.equal(plannedTemplateId(rotation({ position: 4 }), MONDAY), 'pull');
  });

  it('has nothing to offer from an empty rotation', () => {
    assert.equal(plannedTemplateId(rotation({ rotation: [] }), MONDAY), null);
  });
});

describe('advanced', () => {
  it('moves a rotation on by one and wraps', () => {
    assert.equal(advanced(rotation({ position: 0 })), 1);
    assert.equal(advanced(rotation({ position: 2 })), 0);
  });

  it('leaves a weekday plan position alone', () => {
    assert.equal(advanced(weekday({ position: 3 })), 3);
  });
});

describe('planSummary', () => {
  it('lists a weekday plan in day order', () => {
    assert.equal(planSummary(weekday(), templates), 'Mon Chest day A · Thu Chest day B');
  });

  it('lists a rotation in order', () => {
    assert.equal(planSummary(rotation(), templates), 'Push → Pull → Legs');
  });

  it('names what comes after the session due now', () => {
    assert.deepEqual(upcomingTemplateIds(rotation({ position: 2 }), 2), ['push', 'pull']);
  });
});
