export interface CcItem {
  key: string
  row: number
  group: number
  group_en: string
  group_cn: string
  desc_en: string
  desc_cn: string
  pkg: string
  default: number
  is_foc: boolean
}

export const CC_ITEMS: CcItem[] = [
  { key: 'CC_R2',  row: 2,  group: 1, group_en: 'Company Changes incl. ACRA Lodgement', group_cn: '公司变更包括向ACRA提交', desc_en: 'Update particulars (company / shareholders / officers)', desc_cn: '公司/股东/管理人员资料更新', pkg: 'Per Transaction / 每次', default: 0, is_foc: true },
  { key: 'CC_R3',  row: 3,  group: 1, group_en: 'Company Changes incl. ACRA Lodgement', group_cn: '公司变更包括向ACRA提交', desc_en: 'Change of registered office address', desc_cn: '更改公司注册地址', pkg: 'Per Transaction / 每次', default: 0, is_foc: true },
  { key: 'CC_R4',  row: 4,  group: 1, group_en: 'Company Changes incl. ACRA Lodgement', group_cn: '公司变更包括向ACRA提交', desc_en: 'Change of secretary', desc_cn: '更换法定秘书', pkg: 'Per Transaction / 每次', default: 0, is_foc: true },
  { key: 'CC_R5',  row: 5,  group: 1, group_en: 'Company Changes incl. ACRA Lodgement', group_cn: '公司变更包括向ACRA提交', desc_en: 'Change of business activities', desc_cn: '变更营业范围', pkg: 'Per Transaction / 每次', default: 0, is_foc: true },
  { key: 'CC_R6',  row: 6,  group: 1, group_en: 'Company Changes incl. ACRA Lodgement', group_cn: '公司变更包括向ACRA提交', desc_en: 'Change of auditor (FOC if our auditor; SGD 50 if outside)', desc_cn: '更换审计师（使用我们的审计师免费；否则SGD 50）', pkg: 'Per Transaction / 每次', default: 0, is_foc: true },
  { key: 'CC_R7',  row: 7,  group: 1, group_en: 'Company Changes incl. ACRA Lodgement', group_cn: '公司变更包括向ACRA提交', desc_en: 'AGM and Annual Return (Gov. fee SGD 60 applicable)', desc_cn: '股东年度大会及年检（政府费用SGD 60另收）', pkg: 'Per Transaction / 每次', default: 0, is_foc: true },
  { key: 'CC_R8',  row: 8,  group: 1, group_en: 'Company Changes incl. ACRA Lodgement', group_cn: '公司变更包括向ACRA提交', desc_en: 'Appointment and resignation of officer', desc_cn: '管理人员的任命及辞职', pkg: 'Per Transaction / 每次', default: 100, is_foc: false },
  { key: 'CC_R9',  row: 9,  group: 1, group_en: 'Company Changes incl. ACRA Lodgement', group_cn: '公司变更包括向ACRA提交', desc_en: 'Dividend declaration', desc_cn: '分红', pkg: 'Per Transaction / 每次', default: 100, is_foc: false },
  { key: 'CC_R10', row: 10, group: 1, group_en: 'Company Changes incl. ACRA Lodgement', group_cn: '公司变更包括向ACRA提交', desc_en: 'Any other lodgements (non-regular changes)', desc_cn: '除定期更改外的其他任何提交', pkg: 'Per Transaction / 每次', default: 50, is_foc: false },
  { key: 'CC_R11', row: 11, group: 2, group_en: 'Special Resolution incl. ACRA Lodgement', group_cn: '特别董事决议包括向ACRA提交', desc_en: 'Change of company name', desc_cn: '公司名称变更', pkg: 'Per Transaction / 每次', default: 300, is_foc: false },
  { key: 'CC_R12', row: 12, group: 2, group_en: 'Special Resolution incl. ACRA Lodgement', group_cn: '特别董事决议包括向ACRA提交', desc_en: 'Amendment in company Constitution', desc_cn: '修改公司章程', pkg: 'Per Transaction / 每次', default: 300, is_foc: false },
  { key: 'CC_R13', row: 13, group: 2, group_en: 'Special Resolution incl. ACRA Lodgement', group_cn: '特别董事决议包括向ACRA提交', desc_en: 'Split / replace share certificate', desc_cn: '补股份证书', pkg: 'Per Transaction / 每次', default: 100, is_foc: false },
  { key: 'CC_R14', row: 14, group: 2, group_en: 'Special Resolution incl. ACRA Lodgement', group_cn: '特别董事决议包括向ACRA提交', desc_en: 'Removal of charge for ACRA register', desc_cn: '向ACRA消贷款登记', pkg: 'Per Transaction / 每次', default: 200, is_foc: false },
  { key: 'CC_R15', row: 15, group: 2, group_en: 'Special Resolution incl. ACRA Lodgement', group_cn: '特别董事决议包括向ACRA提交', desc_en: 'EGM for bank facilities / other investment', desc_cn: '银行融资/其他投资的特别股东大会', pkg: 'Per Transaction / 每次', default: 300, is_foc: false },
  { key: 'CC_R16', row: 16, group: 2, group_en: 'Special Resolution incl. ACRA Lodgement', group_cn: '特别董事决议包括向ACRA提交', desc_en: 'Any other lodgements (non-regular, from SGD 200)', desc_cn: '除定期更改外的其他任何提交（SGD 200起）', pkg: 'Per Transaction / 每次', default: 200, is_foc: false },
  { key: 'CC_R17', row: 17, group: 3, group_en: 'Share Issue and Transfer', group_cn: '股份发行及转让', desc_en: 'Allotment of shares / Increase paid-up capital', desc_cn: '配股/增加实收资本', pkg: 'Per Transaction / 每次', default: 200, is_foc: false },
  { key: 'CC_R18', row: 18, group: 3, group_en: 'Share Issue and Transfer', group_cn: '股份发行及转让', desc_en: 'Share transfer (excl. Stamp Duty & Gov. fee)', desc_cn: '股份转让（不含印花税及政府费用）', pkg: 'Per Transaction / 每次', default: 300, is_foc: false },
  { key: 'CC_R19', row: 19, group: 3, group_en: 'Share Issue and Transfer', group_cn: '股份发行及转让', desc_en: 'Share transfer with corporate shareholder (excl. Stamp Duty & Gov. fee)', desc_cn: '含企业股东的股份转让（不含印花税及政府费用）', pkg: 'Per Transaction / 每次', default: 400, is_foc: false },
  { key: 'CC_R20', row: 20, group: 4, group_en: 'Share Capital Reduction', group_cn: '降低资本金', desc_en: 'EGM preparation and ACRA lodgements', desc_cn: '股东大会文件及ACRA记录更新', pkg: 'Per Transaction / 每次', default: 2000, is_foc: false },
  { key: 'CC_R21', row: 21, group: 5, group_en: 'Trade Mark Application (Singapore)', group_cn: '商标申请（新加坡）', desc_en: 'Apply trade mark and assist to prepare documents', desc_cn: '申请商标并协助准备文件', pkg: 'One-Off / 一次性', default: 900, is_foc: false },
  { key: 'CC_R22', row: 22, group: 6, group_en: 'Secretary Attendance Services', group_cn: '秘书出席服务', desc_en: 'Assist and attend bank for bank requirements', desc_cn: '协助并出席银行要求', pkg: 'One-Off / 一次性', default: 200, is_foc: false },
  { key: 'CC_R23', row: 23, group: 6, group_en: 'Secretary Attendance Services', group_cn: '秘书出席服务', desc_en: 'Assist and attend court (for tax purposes)', desc_cn: '代表税务目的出席法庭', pkg: 'One-Off / 一次性', default: 500, is_foc: false },
  { key: 'CC_R24', row: 24, group: 7, group_en: 'Voluntarily Striking Off', group_cn: '自愿注销公司', desc_en: 'Dormant Company', desc_cn: '休眠公司', pkg: 'One-Off / 一次性', default: 500, is_foc: false },
  { key: 'CC_R25', row: 25, group: 7, group_en: 'Voluntarily Striking Off', group_cn: '自愿注销公司', desc_en: 'Active Company', desc_cn: '活跃公司', pkg: 'One-Off / 一次性', default: 600, is_foc: false },
  { key: 'CC_R26', row: 26, group: 8, group_en: 'Corporate Account Closure Service', group_cn: '企业账关闭申请服务', desc_en: 'Assist to Close Corporate Account', desc_cn: '协助关闭公司帐户', pkg: 'One-Off / 一次性', default: 200, is_foc: false },
  { key: 'CC_R27', row: 27, group: 9, group_en: 'Other / Additional Services', group_cn: '其他服务', desc_en: 'CTC documents', desc_cn: '文件见证签字', pkg: 'Per Set / 每份', default: 50, is_foc: false },
  { key: 'CC_R28', row: 28, group: 9, group_en: 'Other / Additional Services', group_cn: '其他服务', desc_en: 'Register of Director / Shareholder / Secretary etc.', desc_cn: '董事/股东/秘书等的登记册', pkg: 'Per Set / 每份', default: 40, is_foc: false },
  { key: 'CC_R29', row: 29, group: 9, group_en: 'Other / Additional Services', group_cn: '其他服务', desc_en: 'Lodgement of Register of Controller', desc_cn: '实际控制人登记册的递交', pkg: 'Per Lodgement / 每次登记', default: 80, is_foc: false },
  { key: 'CC_R30', row: 30, group: 9, group_en: 'Other / Additional Services', group_cn: '其他服务', desc_en: 'KYC / Due Diligence / CDD / Background / Compliance Check', desc_cn: 'KYC/尽职调查/背景调查/合规检查', pkg: 'Per Time / 每次', default: 100, is_foc: false },
]
