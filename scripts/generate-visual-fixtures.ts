import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { generateDocx, type DocInput } from '../lib/docGenerator'
import { SERVICES } from '../lib/services'
import { CC_ITEMS } from '../lib/company-changes'

type LanguageMode = 'bilingual' | 'english-only'

interface VisualScenario {
  name: string
  languageMode: LanguageMode
  selected: string[]
  description: string
}

const ALL_SERVICES = SERVICES.map((service) => service.key)
const MINIMAL = ['INCORP', 'ACCOUNTS']
const DYNAMIC_STRESS = ['INCORP', 'ACCOUNTS', 'ND2', 'ND_DEPOSIT2', 'XBRL', 'AUDIT', 'AIS']

const SCENARIOS: VisualScenario[] = [
  { name: 'bilingual-minimal', languageMode: 'bilingual', selected: MINIMAL, description: 'Minimal bilingual proposal' },
  { name: 'bilingual-dynamic-stress', languageMode: 'bilingual', selected: DYNAMIC_STRESS, description: 'Bilingual dynamic rows and nominee deposit' },
  { name: 'bilingual-all-services', languageMode: 'bilingual', selected: ALL_SERVICES, description: 'Bilingual full service selection' },
  { name: 'english-minimal', languageMode: 'english-only', selected: MINIMAL, description: 'Minimal English proposal' },
  { name: 'english-dynamic-stress', languageMode: 'english-only', selected: DYNAMIC_STRESS, description: 'English dynamic rows and nominee deposit' },
  { name: 'english-all-services', languageMode: 'english-only', selected: ALL_SERVICES, description: 'English full service selection' },
]

const feeOverrides: Record<string, number> = Object.fromEntries(
  SERVICES.filter((service) => service.fee !== null).map((service) => [service.key, service.fee as number]),
)
feeOverrides.GOODWILL_DISC = 100

const ccOverrides = Object.fromEntries(CC_ITEMS.map((item) => [item.key, item.default]))

async function main() {
  const outArg = process.argv.indexOf('--out')
  const outputDir = resolve(outArg >= 0 && process.argv[outArg + 1]
    ? process.argv[outArg + 1]
    : join(process.cwd(), 'artifacts', 'visual-regression', 'documents'))
  mkdirSync(outputDir, { recursive: true })

  const manifest: Array<VisualScenario & { file: string }> = []
  for (const scenario of SCENARIOS) {
    const selected = [...new Set(scenario.selected)]
    const input: DocInput = {
      companyName: 'Tassure Visual QA Pte. Ltd.',
      date: '29 August 2026',
      salutationEn: 'Dear Management,',
      salutationCn: '尊敬的管理层：',
      mode: 'selected',
      selected,
      feeOverrides,
      ccOverrides,
      focServices: SERVICES
        .filter((service) => selected.includes(service.key) && ['foc', 'bundled'].includes(service.fee_type))
        .map((service) => service.key),
      languageMode: scenario.languageMode,
    }
    const file = `${scenario.name}.docx`
    writeFileSync(join(outputDir, file), await generateDocx(input))
    manifest.push({ ...scenario, selected, file })
    console.log(`${scenario.name}: generated`)
  }

  writeFileSync(join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`Visual fixtures: ${outputDir}`)
}

main().catch((error) => { console.error(error); process.exit(1) })
