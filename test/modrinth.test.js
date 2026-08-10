import assert from 'node:assert/strict';
import test from 'node:test';
import { splitProjectQuery, versionMatches } from '../src/modrinth.js';

test('splits a project slug and requested version', () => {
  assert.deepEqual(splitProjectQuery('sodium@0.8.12'), {
    projectQuery: 'sodium',
    requestedVersion: '0.8.12'
  });
});

test('matches Modrinth version suffixes without prefix collisions', () => {
  assert.equal(versionMatches('0.8.12+mc1.21.11', '0.8.12'), true);
  assert.equal(versionMatches('fabric-1.21.11-26.4.2', '26.4.2'), true);
  assert.equal(versionMatches('0.8.120+mc1.21.11', '0.8.12'), false);
});
