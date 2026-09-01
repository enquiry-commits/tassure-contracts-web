import {
  DEFAULT_MAPPING, DEFAULT_MAPPING_EN, ROW_DEFS, ROW_DEFS_EN, SERVICES,
} from './services'
import { CC_ITEMS } from './company-changes'

export type ProposalLanguageMode = 'bilingual' | 'english-only'

export interface ProposalPlanInput {
  selected: string[]
  feeOverrides: Record<string, number>
  ccOverrides: Record<string, number>
  sectionMapping?: Record<string, string[]>
  languageMode?: ProposalLanguageMode
}

export interface ServiceImpact {
  serviceKey: string
  selected: boolean
  rowIds: string[]
  action: 'keep' | 'remove'
}

export interface ProposalPlan {
  languageMode: ProposalLanguageMode
  selected: string[]
  mapping: Record<string, string[]>
  impacts: ServiceImpact[]
  rowsByService: Record<string, string[]>
}

const DYNAMIC_TARGETS: Record<string, { bilingual: string[]; 'english-only': string[] }> = {
  CERT: { bilingual: ['MAIN_CERT'], 'english-only': ['MAIN_CERT'] },
  DP_MAIN: { bilingual: ['MAIN_DP_MAIN'], 'english-only': ['MAIN_DP_MAIN'] },
  LOC_MAIN: { bilingual: ['MAIN_LOC_MAIN'], 'english-only': ['MAIN_LOC_MAIN'] },
  GOODWILL_DISC: { bilingual: ['MAIN_GOODWILL'], 'english-only': ['MAIN_GOODWILL'] },
  DP_RENEW: { bilingual: ['EP_DP_RENEW'], 'english-only': ['EP_DP_RENEW'] },
  XBRL: { bilingual: ['OPT_XBRL'], 'english-only': ['OPT_XBRL'] },
  AUDIT: { bilingual: ['OPT_AUDIT'], 'english-only': ['OPT_AUDIT'] },
  AIS: { bilingual: ['OPT_AIS'], 'english-only': ['OPT_AIS_EN'] },
}

const SERVICE_KEYS = new Set(SERVICES.map((service) => service.key))
// The primary nominee-director deposit is a fee-bearing sub-row of ND rather
// than a standalone service. It is therefore intentionally absent from
// SERVICES, but the generator and quote builder both support overriding it.
const FEE_OVERRIDE_KEYS = new Set([...SERVICE_KEYS, 'ND_DEPOSIT'])
const CC_KEYS = new Set(CC_ITEMS.map((item) => item.key))

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function assertFiniteAmounts(values: Record<string, number>, allowed: Set<string>, label: string): void {
  for (const [key, value] of Object.entries(values)) {
    if (!allowed.has(key)) throw new Error(`${label}: unknown key ${key}`)
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label}.${key}: amount must be a finite non-negative number`)
  }
}

export function buildProposalPlan(input: ProposalPlanInput): ProposalPlan {
  const languageMode = input.languageMode ?? 'bilingual'
  const rowDefs = languageMode === 'english-only' ? ROW_DEFS_EN : ROW_DEFS
  const defaultMapping = languageMode === 'english-only' ? DEFAULT_MAPPING_EN : DEFAULT_MAPPING
  const selected = unique(input.selected)

  for (const key of selected) {
    if (!SERVICE_KEYS.has(key)) throw new Error(`selected: unknown service ${key}`)
  }
  if (selected.includes('ND_DEPOSIT2') && !selected.includes('ND2')) {
    throw new Error('selected: ND_DEPOSIT2 requires ND2')
  }
  if (input.feeOverrides.ND_DEPOSIT !== undefined && !selected.includes('ND')) {
    throw new Error('feeOverrides: ND_DEPOSIT requires ND')
  }
  assertFiniteAmounts(input.feeOverrides, FEE_OVERRIDE_KEYS, 'feeOverrides')
  assertFiniteAmounts(input.ccOverrides, CC_KEYS, 'ccOverrides')

  const suppliedMapping = input.sectionMapping ?? defaultMapping
  const mapping: Record<string, string[]> = {}
  for (const service of SERVICES) {
    const targets = suppliedMapping[service.key] ?? []
    for (const rowId of targets) {
      if (!rowDefs[rowId]) throw new Error(`sectionMapping.${service.key}: unknown row ${rowId} for ${languageMode}`)
    }
    mapping[service.key] = unique(targets)
  }
  for (const key of Object.keys(suppliedMapping)) {
    if (!SERVICE_KEYS.has(key)) throw new Error(`sectionMapping: unknown service ${key}`)
  }

  const selectedSet = new Set(selected)
  const rowsByService: Record<string, string[]> = {}
  const impacts = SERVICES.map((service): ServiceImpact => {
    const dynamicTargets = DYNAMIC_TARGETS[service.key]?.[languageMode] ?? []
    const rowIds = unique([...(mapping[service.key] ?? []), ...dynamicTargets])
    for (const rowId of rowIds) {
      if (!rowDefs[rowId]) throw new Error(`proposal contract: ${service.key} targets missing row ${rowId}`)
    }
    rowsByService[service.key] = rowIds
    const isSelected = selectedSet.has(service.key)
    return { serviceKey: service.key, selected: isSelected, rowIds, action: isSelected ? 'keep' : 'remove' }
  })

  return { languageMode, selected, mapping, impacts, rowsByService }
}
