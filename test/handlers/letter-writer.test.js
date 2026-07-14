const test = require('node:test');
const assert = require('node:assert/strict');
const { loadLetterWriterConfig } = require('../../src/apps/letterWriter/config');
const {
  createLetter,
  resolveLetterhead,
  safeFilename,
} = require('../../src/apps/letterWriter/service');

function createConfig() {
  return {
    bucketName: 'letters-test',
    s3Prefix: 'mcp/letters',
    presignExpiresSeconds: 900,
  };
}

test('LetterWriter config enables itself from bucket configuration and supports a route-specific secret', () => {
  const config = loadLetterWriterConfig({
    AWS_BUCKET_NAME: 'letters-test',
    AWS_REGION: 'us-west-2',
    LETTER_WRITER_MCP_SHARED_SECRET: 'letter-secret',
    LETTER_WRITER_MCP_SHARED_SECRET_HEADER: 'X-Letter-Secret',
    PRESIGN_EXPIRES_SECONDS: '900',
  });

  assert.equal(config.enabled, true);
  assert.equal(config.region, 'us-west-2');
  assert.equal(config.sharedSecret, 'letter-secret');
  assert.equal(config.sharedSecretHeader, 'x-letter-secret');
  assert.equal(config.presignExpiresSeconds, 900);
});

test('LetterWriter uses distinct auth defaults unless it inherits the global secret', () => {
  const distinct = loadLetterWriterConfig({
    AWS_BUCKET_NAME: 'letters-test',
    LETTER_WRITER_MCP_SHARED_SECRET: 'letter-secret',
    MCP_SHARED_SECRET_HEADER: 'x-legalserver-mcp-secret',
  });
  assert.equal(distinct.sharedSecretHeader, 'x-letter-writer-mcp-secret');

  const inherited = loadLetterWriterConfig({
    AWS_BUCKET_NAME: 'letters-test',
    MCP_SHARED_SECRET: 'global-secret',
    MCP_SHARED_SECRET_HEADER: 'x-global-secret',
  });
  assert.equal(inherited.sharedSecretHeader, 'x-global-secret');
});

test('LetterWriter can be disabled when AWS configuration is absent', () => {
  const config = loadLetterWriterConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.bucketName, null);

  assert.throws(
    () => loadLetterWriterConfig({ LETTER_WRITER_ENABLED: 'true' }),
    /AWS_BUCKET_NAME/,
  );
});

test('LetterWriter resolves office aliases and sanitizes filenames', () => {
  assert.equal(resolveLetterhead({ office_hint: 'Montgomery County Office' }).id, 'montgomery_county');
  assert.equal(resolveLetterhead({ office_hint: 'Unknown Satellite' }).id, 'generic');
  assert.equal(safeFilename('../../Client "Name"'), '..-..-Client -Name-.docx');
});

test('createLetter renders a DOCX and uploads it under an opaque S3 key', async () => {
  const commands = [];
  const s3Client = {
    async send(command) {
      commands.push(command);
      return {};
    },
  };
  const result = await createLetter({
    client_name: 'Alex Client',
    client_last_name: 'Client',
    address1: '100 Main Street',
    message_body: 'This is a test letter.',
    attorney: 'Jordan Lawyer',
    letterhead_id: 'generic',
    filename: 'Letter for Client.docx',
  }, {
    config: createConfig(),
    s3Client,
    getSignedUrlImpl: async (_client, command, options) => {
      assert.equal(command.input.Bucket, 'letters-test');
      assert.equal(options.expiresIn, 900);
      return 'https://download.example.test/signed';
    },
  });

  assert.equal(commands.length, 1);
  assert.equal(commands[0].input.Bucket, 'letters-test');
  assert.match(commands[0].input.Key, /^mcp\/letters\/.+\.docx$/);
  assert.equal(commands[0].input.Key.includes('Client'), false);
  assert.equal(Buffer.isBuffer(commands[0].input.Body), true);
  assert.equal(commands[0].input.ContentDisposition, 'attachment; filename="Letter for Client.docx"');
  assert.equal(result.content[1].type, 'resource_link');
  assert.equal(result.content[1].uri, 'https://download.example.test/signed');
});

test('createLetter enforces input length limits before uploading', async () => {
  await assert.rejects(
    () => createLetter({
      client_name: 'Alex Client',
      client_last_name: 'Client',
      address1: '100 Main Street',
      message_body: 'x'.repeat(50001),
      attorney: 'Jordan Lawyer',
    }, {
      config: createConfig(),
      s3Client: { send: async () => assert.fail('upload must not run') },
    }),
    /message_body must be at most 50000 characters/,
  );
});
