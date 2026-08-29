import assert from 'node:assert/strict'
import { buildProposalPlan } from '../lib/proposal-plan'
import { SERVICES } from '../lib/services'

const base: { selected: string[]; feeOverrides: Record<string, number>; ccOverrides: Record<string, number> } = {
  selected: ['INCORP'],
  feeOverrides: {},
  ccOverrides: {},
}

for (const languageMode of ['bilingual', 'english-only'] as const) {
  const allSelected = SERVICES.map((service) => service.key)
  const plan = buildProposalPlan({ ...base, selected: allSelected, languageMode })
  assert.equal(plan.impacts.length, SERVICES.length)
  assert.ok(plan.rowsByService.XBRL.includes('OPT_XBRL'))
  assert.ok(plan.rowsByService.AUDIT.includes('OPT_AUDIT'))
  assert.ok(plan.rowsByService.AIS.includes(languageMode === 'english-only' ? 'OPT_AIS_EN' : 'OPT_AIS'))
  assert.ok(plan.rowsByService.CERT.includes('MAIN_CERT'))
}

assert.throws(
  () => buildProposalPlan({ ...base, selected: ['UNKNOWN'] }),
  /unknown service UNKNOWN/,
)
assert.throws(
  () => buildProposalPlan({ ...base, selected: ['ND_DEPOSIT2'] }),
  /requires ND2/,
)
assert.throws(
  () => buildProposalPlan({ ...base, feeOverrides: { INCORP: Number.NaN } }),
  /finite non-negative/,
)
assert.throws(
  () => buildProposalPlan({ ...base, sectionMapping: { INCORP: ['MISSING_ROW'] } }),
  /unknown row MISSING_ROW/,
)

console.log('Proposal plan contract: PASS')
