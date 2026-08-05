import { generateDocx } from './lib/docGenerator.ts';
import fs from 'fs';

const testInput = {
  companyName: "Test Company Ltd",
  date: "04 August 2026",
  salutationEn: "Dear Management,",
  salutationCn: "尊敬的领导，",
  mode: "full",
  selected: ['SG_CORP'],
  feeOverrides: {
    'SG_CORP': 300,
  },
  ccOverrides: {
    'CC_R11': 300,
  },
  sectionMapping: {},
  focServices: [],
};

console.log('Testing document generation...');
console.log('Input:', JSON.stringify(testInput, null, 2));

try {
  const buffer = await generateDocx(testInput);
  console.log(`\nGenerated buffer size: ${buffer.length} bytes`);

  // Save to file
  fs.writeFileSync('/tmp/test-output.docx', buffer);
  console.log('Document saved to /tmp/test-output.docx');
} catch (err) {
  console.error('Error:', err);
  process.exit(1);
}
