// Pure merge logic for the Guarantor Contract pipeline: fills the approved
// docx template (templates/guarantor-contract.docx) with confirmed field
// values and returns the merged docx as a Buffer. No PDF conversion here —
// that happens in the separate convert-pdf container function.
//
// Every required field is validated *before* docxtemplater ever touches the
// template: a missing/empty field throws MissingFieldError rather than
// silently rendering a blank onto a signed legal document.

const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

const DEFAULT_TEMPLATE_PATH = path.join(__dirname, '..', '..', 'templates', 'guarantor-contract.docx');

const REQUIRED_FIELDS = [
  'tenant_name', 'tenant_address', 'tenant_civil_id', 'tenant_phone',
  'guarantor_name', 'guarantor_address', 'guarantor_civil_id', 'guarantor_phone',
  'rent_amount_gbp', 'rent_due_day',
  'contract_start_date', 'contract_end_date',
  'contract_weekday', 'contract_date',
  'uk_property_address',
  'tenant_title', 'guarantor_title'
];

// Optional per the confirmed decision: passport is sometimes never supplied.
const OPTIONAL_FIELDS = ['tenant_passport', 'guarantor_passport'];

class MissingFieldError extends Error {
  constructor(fieldNames) {
    super(`Missing required contract field(s): ${fieldNames.join(', ')}`);
    this.name = 'MissingFieldError';
    this.fields = fieldNames;
  }
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

// Fields inserted into an RTL paragraph that contain "+", spaces, or other
// bidi-neutral characters (phone numbers, passport numbers) can have their
// space-separated groups visually reordered by the Unicode bidi algorithm —
// e.g. "+44 7700 900111" rendering as "7700 44+ / 900111" across two lines.
// Wrapping the value in LRI (U+2066) / PDI (U+2069) isolates forces it to
// resolve as a single left-to-right run regardless of the surrounding RTL
// context, without touching the template's XML.
const LTR_ISOLATED_FIELDS = ['tenant_phone', 'guarantor_phone', 'tenant_passport', 'guarantor_passport'];
const LRI = '⁦';
const PDI = '⁩';

function ltrIsolate(value) {
  return value ? `${LRI}${value}${PDI}` : value;
}

function validateFields(fields) {
  const missing = REQUIRED_FIELDS.filter((name) => isBlank(fields[name]));
  if (missing.length > 0) {
    throw new MissingFieldError(missing);
  }
}

/**
 * @param {Record<string, string|number>} fields
 * @param {string} [templatePath] override for tests — a fixture docx with a
 *   couple of {{}} tags, so the pipeline's validation/merge logic can be
 *   exercised without depending on the real legal template.
 * @returns {Buffer} the merged .docx
 */
function mergeContract(fields, templatePath = DEFAULT_TEMPLATE_PATH) {
  validateFields(fields);

  const data = {};
  for (const name of REQUIRED_FIELDS) {
    const value = String(fields[name]);
    data[name] = LTR_ISOLATED_FIELDS.includes(name) ? ltrIsolate(value) : value;
  }
  for (const name of OPTIONAL_FIELDS) {
    const value = isBlank(fields[name]) ? '' : String(fields[name]);
    data[name] = LTR_ISOLATED_FIELDS.includes(name) ? ltrIsolate(value) : value;
  }

  const content = fs.readFileSync(templatePath, 'binary');
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    delimiters: { start: '{{', end: '}}' },
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: (part) => {
      throw new MissingFieldError([part.value]);
    }
  });

  doc.render(data);

  return doc.getZip().generate({ type: 'nodebuffer' });
}

module.exports = { mergeContract, MissingFieldError, REQUIRED_FIELDS, OPTIONAL_FIELDS };
