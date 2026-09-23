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
  'contract_weekday', 'contract_date'
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
  for (const name of REQUIRED_FIELDS) data[name] = String(fields[name]);
  for (const name of OPTIONAL_FIELDS) data[name] = isBlank(fields[name]) ? '' : String(fields[name]);

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
