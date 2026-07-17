#!/usr/bin/env node

require('dotenv').config({ quiet: true });

const { loadConfig } = require('../src/apps/legalserver/config');
const { discoverFixtures } = require('../src/apps/legalserver/benchmark/discovery');
const { getFixturesPath, writeJsonFile } = require('../src/apps/legalserver/benchmark/files');

async function main() {
  const config = loadConfig(process.env);
  const fixtures = await discoverFixtures(config);
  const fixturesPath = getFixturesPath();

  writeJsonFile(fixturesPath, fixtures);

  console.log(`Discovered benchmark fixtures at ${fixturesPath}`);
  if (fixtures.discovery_warnings.length > 0) {
    console.log('\nDiscovery warnings');
    for (const warning of fixtures.discovery_warnings) {
      console.log(`- ${warning}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
