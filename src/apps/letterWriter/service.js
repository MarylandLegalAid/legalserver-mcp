const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DEFAULT_LETTERHEAD_ID = 'generic';

const LETTERHEADS = [
  {
    id: 'generic',
    label: 'Generic',
    file: 'generic.docx',
    legalserver_offices: ['Statewide Advocacy Support'],
    aliases: ['generic', 'statewide advocacy support', 'statewide', 'advocacy support'],
  },
  {
    id: 'baltimore_city',
    label: 'Baltimore City',
    file: 'baltimore-city.docx',
    legalserver_offices: ['Baltimore City'],
    aliases: ['baltimore city', 'baltimore city office'],
  },
  {
    id: 'baltimore_county_suite_300',
    label: 'Baltimore County Suite 300',
    file: 'baltimore-county-suite-300.docx',
    aliases: ['baltimore county suite 300', 'baltimore county suite300'],
  },
  {
    id: 'baltimore_county',
    label: 'Baltimore County',
    file: 'baltimore-county.docx',
    legalserver_offices: ['Baltimore County'],
    aliases: ['baltimore county', 'baltimore county office'],
  },
  {
    id: 'allegany_garrett',
    label: 'Allegany/Garrett',
    file: 'allegany-garrett.docx',
    legalserver_offices: ['Allegany / Garrett'],
    aliases: ['allegany garrett', 'allegany county', 'garrett county'],
  },
  {
    id: 'anne_arundel_howard',
    label: 'Anne Arundel/Howard',
    file: 'anne-arundel-howard.docx',
    legalserver_offices: ['Anne Arundel / Howard'],
    aliases: ['anne arundel howard', 'anne arundel county', 'howard county', 'annapolis'],
  },
  {
    id: 'cecil_harford',
    label: 'Cecil/Harford',
    file: 'cecil-harford.docx',
    legalserver_offices: ['Cecil / Harford'],
    aliases: ['cecil harford', 'cecil county', 'harford county'],
  },
  {
    id: 'lower_eastern_shore',
    label: 'Lower Eastern Shore',
    file: 'lower-eastern-shore.docx',
    legalserver_offices: ['Lower Eastern Shore'],
    aliases: ['lower eastern shore', 'wicomico county', 'worcester county', 'somerset county', 'salisbury'],
  },
  {
    id: 'midwestern_md',
    label: 'Midwestern MD',
    file: 'midwestern-md.docx',
    legalserver_offices: ['Midwestern MD'],
    aliases: ['midwestern md', 'midwestern maryland', 'frederick county', 'washington county', 'carroll county', 'hagerstown'],
  },
  {
    id: 'montgomery_county',
    label: 'Montgomery County',
    file: 'montgomery-county.docx',
    legalserver_offices: ['Montgomery County'],
    aliases: ['montgomery county', 'montgomery', 'rockville'],
  },
  {
    id: 'prince_georges_county',
    label: 'Prince George\'s County',
    file: 'prince-georges-county.docx',
    legalserver_offices: ['Prince George\'s County'],
    aliases: ['prince georges county', 'prince george county', 'prince george s county', 'pg county', 'p g county'],
  },
  {
    id: 'southern_md',
    label: 'Southern MD',
    file: 'southern-md.docx',
    legalserver_offices: ['Southern MD'],
    aliases: ['southern md', 'southern maryland', 'calvert county', 'charles county', 'st marys county', 'saint marys county'],
  },
  {
    id: 'upper_eastern_shore',
    label: 'Upper Eastern Shore',
    file: 'upper-eastern-shore.docx',
    legalserver_offices: ['Upper Eastern Shore'],
    aliases: ['upper eastern shore', 'caroline county', 'dorchester county', 'kent county', 'queen annes county', 'queen anne county', 'talbot county'],
  },
];

const LETTERHEAD_BY_ID = new Map(LETTERHEADS.map((letterhead) => [letterhead.id, letterhead]));

// -----------------------------
// Template / DOCX
// -----------------------------
function normalizeMatchText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(office|mla|maryland legal aid|legal aid)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLetterheadId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function collectLetterheadHints(args) {
  const hints = [];
  for (const key of ['office_hint', 'office_display', 'office_name', 'office_code']) {
    if (typeof args?.[key] === 'string' && args[key].trim()) hints.push(args[key]);
  }

  const office = args?.office;
  if (typeof office === 'string' && office.trim()) hints.push(office);
  if (office && typeof office === 'object') {
    for (const key of ['display', 'office_display', 'name', 'office_name', 'code', 'office_code']) {
      if (typeof office[key] === 'string' && office[key].trim()) hints.push(office[key]);
    }
  }

  return hints;
}

function getAliasMatches(letterhead, hint) {
  const normalizedHint = normalizeMatchText(hint);
  if (!normalizedHint) return [];

  return [...(letterhead.legalserver_offices || []), ...letterhead.aliases]
    .map((alias) => normalizeMatchText(alias))
    .filter(Boolean)
    .filter((alias) => normalizedHint === alias || normalizedHint.includes(alias))
    .sort((a, b) => b.length - a.length);
}

function resolveLetterhead(args = {}) {
  const requestedId = normalizeLetterheadId(args.letterhead_id);
  if (requestedId && LETTERHEAD_BY_ID.has(requestedId)) {
    return {
      ...LETTERHEAD_BY_ID.get(requestedId),
      match: { source: 'letterhead_id', value: args.letterhead_id, fallback: false },
    };
  }

  const hints = collectLetterheadHints(args);
  const ranked = [];
  for (const hint of hints) {
    for (const letterhead of LETTERHEADS) {
      const matches = getAliasMatches(letterhead, hint);
      if (matches.length) {
        ranked.push({ letterhead, hint, alias: matches[0], score: matches[0].length });
      }
    }
  }

  ranked.sort((a, b) => b.score - a.score);
  if (ranked[0]) {
    return {
      ...ranked[0].letterhead,
      match: { source: 'office_hint', value: ranked[0].hint, alias: ranked[0].alias, fallback: false },
    };
  }

  return {
    ...LETTERHEAD_BY_ID.get(DEFAULT_LETTERHEAD_ID),
    match: { source: 'fallback', value: hints[0] || args.letterhead_id || null, fallback: true },
  };
}

function firstCleanString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function getSignatureOfficeName(args, letterhead) {
  const office = args?.office;
  const officeNameFromObject = office && typeof office === 'object'
    ? firstCleanString(office.name, office.office_name, office.display, office.office_display)
    : '';

  const officeName = firstCleanString(
    officeNameFromObject,
    typeof office === 'string' ? office : '',
    args?.office_name,
    args?.office_display,
    args?.office_hint
  );

  if (officeName) return officeName;
  if (letterhead.match?.fallback && letterhead.match.value) return String(letterhead.match.value).trim();
  return letterhead.label;
}

function shouldIncludeUnitName(signatureOfficeName, letterhead) {
  return letterhead.id === 'baltimore_city' || normalizeMatchText(signatureOfficeName) === 'baltimore city';
}

function buildSignatureLines(args, letterhead, unitName) {
  const signatureOfficeName = getSignatureOfficeName(args, letterhead);
  const lines = ['Maryland Legal Aid', signatureOfficeName].filter(Boolean);

  if (shouldIncludeUnitName(signatureOfficeName, letterhead) && unitName) {
    lines.push(unitName);
  }

  return lines.join('\n');
}

function loadTemplateBuffer(letterhead) {
  const templatePath = path.join(__dirname, 'templates', 'letterheads', letterhead.file);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found at: ${templatePath}`);
  }
  return fs.readFileSync(templatePath);
}

function formatDateLong(dateString) {
  if (!dateString) {
    return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  const tryISO = /^\d{4}-\d{2}-\d{2}$/.test(dateString) ? `${dateString}T00:00:00` : dateString;
  const d = new Date(tryISO);
  if (Number.isNaN(d.getTime())) return dateString;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function renderDocx(data, letterhead) {
  const zip = new PizZip(loadTemplateBuffer(letterhead));
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter() {
      return '';
    },
  });

  try {
    doc.render(data);
  } catch (err) {
    const details = err?.properties?.errors?.map((e) => ({
      id: e.id,
      explanation: e.properties?.explanation,
      context: e.properties?.context,
      file: e.properties?.file,
      offset: e.properties?.offset,
    }));
    const pretty = details ? JSON.stringify(details, null, 2) : '';
    throw new Error(`DOCX template render failed: ${err.message}\nDetails:\n${pretty}`);
  }

  return doc.getZip().generate({ type: 'nodebuffer' });
}

function safeFilename(name) {
  const base = String(name || '').trim() || `letter-${Date.now()}.docx`;
  let out = base;
  if (!out.toLowerCase().endsWith('.docx')) out += '.docx';
  // strip path separators + control chars
  out = out.replace(/[\/\\"\0-\x1F\x7F]/g, '-');
  // compress spaces
  out = out.replace(/\s+/g, ' ').trim();
  if (out.length > 180) {
    out = `${out.slice(0, 175).trim()}.docx`;
  }
  return out;
}

function makeObjectKey(s3Prefix) {
  const rand = crypto.randomBytes(8).toString('hex');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${s3Prefix}/${ts}-${rand}.docx`.replace(/^\/+/, '');
}

async function uploadDocxToS3({ buffer, config, key, filename, s3Client, getSignedUrlImpl }) {
  const put = new PutObjectCommand({
    Bucket: config.bucketName,
    Key: key,
    Body: buffer,
    ContentType: DOCX_MIME,
    ContentDisposition: `attachment; filename="${filename}"`,
    // You can add tags/metadata if you want:
    // Metadata: { source: 'letter-writer-mcp' },
  });

  await s3Client.send(put);

  // Presigned GET link
  const get = new GetObjectCommand({ Bucket: config.bucketName, Key: key });
  const url = await getSignedUrlImpl(s3Client, get, { expiresIn: config.presignExpiresSeconds });
  return url;
}

const CREATE_LETTER_TOOL = {
  name: 'create_letter',
  description:
    'Create a DOCX letter using the best matching MLA office letterhead template, upload to S3, and return a downloadable link. Falls back to Generic letterhead when no office matches.',
  inputSchema: {
    type: 'object',
    properties: {
      today: { type: 'string', maxLength: 100, description: 'Maps to {today} (YYYY-MM-DD or readable string). Defaults to today.' },
      client_name: { type: 'string', maxLength: 500, description: 'Maps to {client_name}.' },
      address1: { type: 'string', maxLength: 500, description: 'Maps to {address1}.' },
      address2: { type: 'string', maxLength: 500, description: 'Maps to {address2} (optional).' },
      honorific: { type: 'string', maxLength: 50, description: 'Maps to {honorific} (e.g., Mr., Ms., Dr.). Optional.' },
      client_last_name: { type: 'string', maxLength: 250, description: 'Maps to {client_last_name}.' },
      message_body: { type: 'string', maxLength: 50000, description: 'Maps to {message_body}. Use \\n for paragraphs.' },
      attorney: { type: 'string', maxLength: 500, description: 'Maps to {attorney} (template adds ", Esq.").' },
      unit_name: { type: 'string', description: 'Optional unit/program name. It is included in the signature block only when the office is Baltimore City.' },
      letterhead_id: { type: 'string', description: 'Optional explicit letterhead ID. If omitted or unknown, office fields are matched and then Generic is used as fallback.' },
      office_hint: { type: 'string', description: 'Optional office text used to choose letterhead, preferably primary_advocate_assignment.office.display or .name.' },
      office_name: { type: 'string', description: 'Optional office name used to choose letterhead.' },
      office_display: { type: 'string', description: 'Optional office display value used to choose letterhead.' },
      office_code: { type: 'string', description: 'Optional office code used to choose letterhead.' },
      office: {
        anyOf: [
          { type: 'string' },
          {
            type: 'object',
            properties: {
              name: { type: 'string' },
              display: { type: 'string' },
              code: { type: 'string' },
            },
          },
        ],
        description: 'Optional office object/string from primary_advocate_assignment.office.',
      },
      filename: { type: 'string', maxLength: 180, description: 'Optional output filename.' },
    },
    required: ['client_name', 'address1', 'client_last_name', 'message_body', 'attorney'],
    additionalProperties: false,
  },
};

const LIST_LETTERHEADS_TOOL = {
  name: 'list_letterheads',
  description: 'List available office letterhead IDs and labels for create_letter.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

const TOOLS = [CREATE_LETTER_TOOL, LIST_LETTERHEADS_TOOL];

async function createLetter(args, { config, s3Client, getSignedUrlImpl = getSignedUrl }) {
  const {
    today,
    client_name,
    address1,
    address2,
    honorific,
    client_last_name,
    message_body,
    attorney,
    unit_name,
    filename,
  } = args || {};

  for (const key of ['client_name', 'address1', 'client_last_name', 'message_body', 'attorney']) {
    if (!args || typeof args[key] !== 'string' || args[key].trim() === '') {
      throw new Error(`Missing or invalid required field: ${key}`);
    }
  }

  const limits = {
    today: 100,
    client_name: 500,
    address1: 500,
    address2: 500,
    honorific: 50,
    client_last_name: 250,
    message_body: 50000,
    attorney: 500,
    filename: 180,
  };
  for (const [key, maxLength] of Object.entries(limits)) {
    if (typeof args?.[key] === 'string' && args[key].length > maxLength) {
      throw new Error(`${key} must be at most ${maxLength} characters`);
    }
  }

  const letterhead = resolveLetterhead(args);
  const unitName = typeof unit_name === 'string' && unit_name.trim() ? unit_name.trim() : 'Maryland Legal Aid';
  const signatureLines = buildSignatureLines(args, letterhead, unitName);

  const data = {
    today: formatDateLong(today),
    client_name: client_name.trim(),
    address1: address1.trim(),
    address2: typeof address2 === 'string' ? address2.trim() : '',
    honorific: typeof honorific === 'string' ? honorific.trim() : '',
    client_last_name: client_last_name.trim(),
    message_body: message_body.trim(),
    attorney: attorney.trim(),
    signature_lines: signatureLines,
    // Backward compatibility for older copied templates that still have {unit_name}.
    unit_name: signatureLines,
  };

  const buffer = renderDocx(data, letterhead);

  const outName = safeFilename(filename || `Closing Letter - ${client_last_name}.docx`);
  const key = makeObjectKey(config.s3Prefix);

  const url = await uploadDocxToS3({
    buffer,
    config,
    key,
    filename: outName,
    s3Client,
    getSignedUrlImpl,
  });

  // LibreChat MCP schema: return text + resource_link
  return {
    content: [
      {
        type: 'text',
        text: `Document created and uploaded.\n\nLetterhead: ${letterhead.label}${letterhead.match?.fallback ? ' (Generic fallback)' : ''}\nDownload: ${url}`,
      },
      {
        type: 'resource_link',
        name: outName,
        uri: url,
      },
    ],
  };
}

async function listLetterheads() {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          default_fallback: DEFAULT_LETTERHEAD_ID,
          letterheads: LETTERHEADS.map((letterhead) => ({
            id: letterhead.id,
            label: letterhead.label,
            legalserver_offices: letterhead.legalserver_offices || [],
            aliases: letterhead.aliases,
          })),
        }, null, 2),
      },
    ],
  };
}

module.exports = {
  CREATE_LETTER_TOOL,
  LETTERHEADS,
  LIST_LETTERHEADS_TOOL,
  TOOLS,
  createLetter,
  listLetterheads,
  resolveLetterhead,
  safeFilename,
};
