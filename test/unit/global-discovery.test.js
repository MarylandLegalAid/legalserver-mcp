const test = require('node:test');
const assert = require('node:assert/strict');
const helpers = require('../../src/helpers');
const {
  collapseWhitespace,
  findExactMatch,
  normalizeAddressSummary,
  normalizeMatterRef,
  normalizeModuleRef,
  normalizeOrganizationRef,
  normalizeTypeList,
  normalizeUserRef,
} = require('../../src/tools/shared/globalDiscovery');

test('phase 3 normalizers flatten common nested references', () => {
  assert.deepEqual(normalizeUserRef({
    user_id: 5,
    user_uuid: 'user-uuid-1',
    user_name: 'Alex Staff',
  }), {
    user_uuid: 'user-uuid-1',
    id: 5,
    name: 'Alex Staff',
  });

  assert.deepEqual(normalizeOrganizationRef({
    organization_id: 8,
    organization_uuid: 'org-uuid-1',
    organization_name: 'County Court',
  }), {
    organization_uuid: 'org-uuid-1',
    id: 8,
    name: 'County Court',
  });

  assert.deepEqual(normalizeMatterRef({
    matter_id: 12,
    matter_uuid: 'matter-uuid-1',
    matter_identification_number: '24-0001',
    matter: 'Client v. Landlord',
  }), {
    case_uuid: 'matter-uuid-1',
    case_id: 12,
    case_number: '24-0001',
    case_title: 'Client v. Landlord',
  });

  assert.deepEqual(normalizeModuleRef({
    event_id: 31,
    event_uuid: 'event-uuid-1',
    event_name: 'Hearing',
  }), {
    module_type: 'event',
    id: 31,
    uuid: 'event-uuid-1',
    label: 'Hearing',
  });
});

test('phase 3 helper utilities normalize types, whitespace, and address summaries', () => {
  assert.deepEqual(normalizeTypeList('Staff, Volunteer', helpers), ['Staff', 'Volunteer']);
  assert.equal(collapseWhitespace('  Legal   Aid   Org '), 'Legal Aid Org');
  assert.equal(normalizeAddressSummary({
    street: '123 Main',
    street_2: 'Suite 100',
    city: 'Boston',
    state: 'MA',
    zip: '02110',
  }), '123 Main, Suite 100, Boston, MA, 02110');
});

test('findExactMatch returns a single exact match across pages', async () => {
  const calls = [];
  const client = {
    async getJson(_path, { query }) {
      calls.push(query.page_number);

      if (query.page_number === 1) {
        return {
          data: [{ login: 'other' }],
          page: 1,
          pageSize: 25,
          totalPages: 2,
          totalRecords: 2,
        };
      }

      return {
        data: [{ login: 'target' }],
        page: 2,
        pageSize: 25,
        totalPages: 2,
        totalRecords: 2,
      };
    },
  };

  const match = await findExactMatch({
    client,
    helpers,
    pathTemplate: '/api/v1/users',
    query: { login: 'target' },
    compare: (record) => record.login === 'target',
    inputLabel: 'login target',
    subject: 'user',
  });

  assert.equal(match.login, 'target');
  assert.deepEqual(calls, [1, 2]);
});

test('findExactMatch throws not_found and multiple_matches with the phase 3 statuses', async () => {
  const notFoundClient = {
    async getJson() {
      return {
        data: [],
        page: 1,
        pageSize: 25,
        totalPages: 0,
        totalRecords: 0,
      };
    },
  };

  await assert.rejects(
    () => findExactMatch({
      client: notFoundClient,
      helpers,
      pathTemplate: '/api/v1/contacts',
      query: { email: 'missing@example.org' },
      compare: () => false,
      inputLabel: 'email missing@example.org',
      subject: 'contact',
    }),
    (error) => {
      assert.equal(error.errorCode, 'not_found');
      assert.equal(error.status, 404);
      return true;
    },
  );

  let callCount = 0;
  const duplicateClient = {
    async getJson() {
      callCount += 1;
      return {
        data: [{ name: 'Legal Aid' }, { name: 'Legal Aid' }],
        page: 1,
        pageSize: 25,
        totalPages: 1,
        totalRecords: 2,
      };
    },
  };

  await assert.rejects(
    () => findExactMatch({
      client: duplicateClient,
      helpers,
      pathTemplate: '/api/v1/organizations',
      query: { name: 'Legal Aid' },
      compare: (record) => record.name === 'Legal Aid',
      inputLabel: 'name Legal Aid',
      subject: 'organization',
    }),
    (error) => {
      assert.equal(error.errorCode, 'multiple_matches');
      assert.equal(error.status, 409);
      return true;
    },
  );
  assert.equal(callCount, 1);
});
