#!/usr/bin/env node

require('dotenv').config({ quiet: true });

const { loadConfig } = require('../src/apps/legalserver/config');
const helpers = require('../src/apps/legalserver/helpers');
const { LegalServerClient } = require('../src/apps/legalserver/legalserverClient');
const { createDocumentTextPipeline } = require('../src/apps/legalserver/documentText');
const { createOcrProvider } = require('../src/apps/legalserver/documentText/ocrProviders');
const { createToolRegistry } = require('../src/apps/legalserver/toolRegistry');

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === '--help' || current === '-h') {
      parsed.help = true;
      continue;
    }

    if (!current.startsWith('--')) {
      continue;
    }

    const key = current.slice(2).replace(/-/g, '_');
    parsed[key] = next && !next.startsWith('--') ? next : 'true';
    if (parsed[key] === next) {
      index += 1;
    }
  }

  return parsed;
}

function printUsage() {
  console.log(`
Usage:
  npm run manual:phase3 -- --contact_email <email> --user_login <login> --organization_name <name> --current_user_email <email> --task_date <yyyy-mm-dd> --event_date <yyyy-mm-dd> --range_start_date <yyyy-mm-dd> --range_end_date <yyyy-mm-dd>

Environment fallbacks:
  PHASE3_CONTACT_EMAIL
  PHASE3_USER_LOGIN
  PHASE3_ORGANIZATION_NAME
  PHASE3_CURRENT_USER_EMAIL
  PHASE3_TASK_DATE
  PHASE3_EVENT_DATE
  PHASE3_RANGE_START_DATE
  PHASE3_RANGE_END_DATE

Examples:
  npm run manual:phase3 -- --contact_email intake@example.org --user_login jstaff --organization_name "Legal Aid Partners" --current_user_email jstaff@example.org --task_date 2026-03-12 --event_date 2026-03-12 --range_start_date 2026-03-12 --range_end_date 2026-03-18
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const contactEmail = args.contact_email || process.env.PHASE3_CONTACT_EMAIL;
  const userLogin = args.user_login || process.env.PHASE3_USER_LOGIN;
  const organizationName = args.organization_name || process.env.PHASE3_ORGANIZATION_NAME;
  const currentUserEmail = args.current_user_email || process.env.PHASE3_CURRENT_USER_EMAIL;
  const taskDate = args.task_date || process.env.PHASE3_TASK_DATE;
  const eventDate = args.event_date || process.env.PHASE3_EVENT_DATE;
  const rangeStartDate = args.range_start_date || process.env.PHASE3_RANGE_START_DATE;
  const rangeEndDate = args.range_end_date || process.env.PHASE3_RANGE_END_DATE;

  if (!contactEmail || !userLogin || !organizationName || !currentUserEmail || !taskDate || !eventDate || !rangeStartDate || !rangeEndDate) {
    printUsage();
    throw new Error('contact_email, user_login, organization_name, current_user_email, task_date, event_date, range_start_date, and range_end_date are required');
  }

  const config = loadConfig(process.env);
  const client = new LegalServerClient({
    baseUrl: config.baseUrl,
    bearerToken: config.bearerToken,
    timeoutMs: config.timeoutMs,
    fetchImpl: global.fetch,
  });
  const registry = createToolRegistry({
    client,
    helpers,
    config,
    documentTextPipeline: createDocumentTextPipeline({
      client,
      config,
      ocrProvider: createOcrProvider(config),
    }),
  });
  const currentUserRequestContext = {
    requestInfo: {
      headers: {
        [config.userEmailHeader || 'x-legalserver-user-email']: currentUserEmail,
      },
    },
  };

  async function runStep(label, fn) {
    try {
      return {
        label,
        ok: true,
        value: await fn(),
      };
    } catch (error) {
      return {
        label,
        ok: false,
        error: {
          error_code: error?.errorCode ?? 'unknown_error',
          status: error?.status ?? null,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  const contact = await runStep('Contact lookup', () => registry.execute('contact_lookup_by_email', { email: contactEmail }));
  const user = await runStep('User lookup', () => registry.execute('user_lookup_by_login', { login: userLogin }));
  const organization = await runStep('Organization lookup', () => registry.execute('organization_lookup_by_name', { name: organizationName }));
  const tasks = await runStep('Task list on date', () => registry.execute('task_list_on_date', { date: taskDate }));
  const events = await runStep('Event list by date', () => registry.execute('event_list_by_date', { date: eventDate }));
  const currentUserProfile = await runStep('Current user profile', () => registry.execute('user_get_current', {}, currentUserRequestContext));
  const currentUserTasksOnDate = await runStep('Current user task list on date', () => registry.execute('task_list_current_user_on_date', { date: taskDate }, currentUserRequestContext));
  const currentUserTasksRange = await runStep('Current user task list in range', () => registry.execute('task_list_current_user_between_dates', {
    start_date: rangeStartDate,
    end_date: rangeEndDate,
  }, currentUserRequestContext));
  const currentUserEventsOnDate = await runStep('Current user event list on date', () => registry.execute('event_list_current_user_on_date', { date: eventDate }, currentUserRequestContext));
  const currentUserEventsRange = await runStep('Current user event list in range', () => registry.execute('event_list_current_user_between_dates', {
    start_date: rangeStartDate,
    end_date: rangeEndDate,
  }, currentUserRequestContext));
  const currentUserMatters = await runStep('Current user matters', () => registry.execute('matter_list_current_user', {}, currentUserRequestContext));

  console.log('\nContact lookup');
  console.log(JSON.stringify(contact.ok ? contact.value.data : contact.error, null, 2));

  console.log('\nUser lookup');
  console.log(JSON.stringify(user.ok ? user.value.data : user.error, null, 2));

  console.log('\nCurrent user profile');
  console.log(JSON.stringify(currentUserProfile.ok ? currentUserProfile.value.data : currentUserProfile.error, null, 2));

  console.log('\nOrganization lookup');
  console.log(JSON.stringify(organization.ok ? organization.value.data : organization.error, null, 2));

  console.log('\nTask list on date');
  console.log(JSON.stringify({
    date: taskDate,
    ...(tasks.ok
      ? {
          total_records: tasks.value.total_records,
          warnings: tasks.value.warnings,
          first_result: tasks.value.data[0] || null,
        }
      : { error: tasks.error }),
  }, null, 2));

  if (tasks.ok && tasks.value.data[0]?.task_uuid) {
    const taskDetail = await runStep('Task detail', () => registry.execute('task_get', {
      task_uuid: tasks.value.data[0].task_uuid,
    }));
    console.log('\nTask detail');
    console.log(JSON.stringify(taskDetail.ok ? taskDetail.value.data : taskDetail.error, null, 2));
  }

  console.log('\nCurrent user task list on date');
  console.log(JSON.stringify({
    date: taskDate,
    ...(currentUserTasksOnDate.ok
      ? {
          total_records: currentUserTasksOnDate.value.total_records,
          warnings: currentUserTasksOnDate.value.warnings,
          first_result: currentUserTasksOnDate.value.data[0] || null,
        }
      : { error: currentUserTasksOnDate.error }),
  }, null, 2));

  console.log('\nCurrent user task list in range');
  console.log(JSON.stringify({
    start_date: rangeStartDate,
    end_date: rangeEndDate,
    ...(currentUserTasksRange.ok
      ? {
          total_records: currentUserTasksRange.value.total_records,
          warnings: currentUserTasksRange.value.warnings,
          first_result: currentUserTasksRange.value.data[0] || null,
        }
      : { error: currentUserTasksRange.error }),
  }, null, 2));

  console.log('\nEvent list by date');
  console.log(JSON.stringify({
    date: eventDate,
    ...(events.ok
      ? {
          total_records: events.value.total_records,
          warnings: events.value.warnings,
          first_result: events.value.data[0] || null,
        }
      : { error: events.error }),
  }, null, 2));

  if (events.ok && events.value.data[0]?.event_uuid) {
    const eventDetail = await runStep('Event detail', () => registry.execute('event_get', {
      event_uuid: events.value.data[0].event_uuid,
    }));
    console.log('\nEvent detail');
    console.log(JSON.stringify(eventDetail.ok ? eventDetail.value.data : eventDetail.error, null, 2));
  }

  console.log('\nCurrent user event list on date');
  console.log(JSON.stringify({
    date: eventDate,
    ...(currentUserEventsOnDate.ok
      ? {
          total_records: currentUserEventsOnDate.value.total_records,
          warnings: currentUserEventsOnDate.value.warnings,
          first_result: currentUserEventsOnDate.value.data[0] || null,
        }
      : { error: currentUserEventsOnDate.error }),
  }, null, 2));

  console.log('\nCurrent user event list in range');
  console.log(JSON.stringify({
    start_date: rangeStartDate,
    end_date: rangeEndDate,
    ...(currentUserEventsRange.ok
      ? {
          total_records: currentUserEventsRange.value.total_records,
          warnings: currentUserEventsRange.value.warnings,
          first_result: currentUserEventsRange.value.data[0] || null,
        }
      : { error: currentUserEventsRange.error }),
  }, null, 2));

  console.log('\nCurrent user matters');
  console.log(JSON.stringify({
    ...(currentUserMatters.ok
      ? {
          total_records: currentUserMatters.value.total_records,
          warnings: currentUserMatters.value.warnings,
          first_result: currentUserMatters.value.data[0] || null,
        }
      : { error: currentUserMatters.error }),
  }, null, 2));

  const failures = [
    contact,
    user,
    organization,
    tasks,
    events,
    currentUserProfile,
    currentUserTasksOnDate,
    currentUserTasksRange,
    currentUserEventsOnDate,
    currentUserEventsRange,
    currentUserMatters,
  ].filter((result) => result.ok === false);
  if (failures.length > 0) {
    throw new Error(`One or more phase 3 manual validation steps failed: ${failures.map((item) => item.label).join(', ')}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
