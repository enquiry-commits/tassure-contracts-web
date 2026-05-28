export type FeeType = 'onetime' | 'yearly' | 'per_person' | 'govt' | 'quote' | 'bundled' | 'foc' | 'from'
export type TableType = 'main' | 'optional' | 'ep'

export interface Service {
  key: string
  cat: string
  num: number
  en: string
  cn: string
  fee: number | null
  fee_type: FeeType
  fee_str: string
  fee_note: string
  default: boolean
  content_type: 'bullets' | 'paras'
  content: [string, string][]
  table: TableType
  table_desc: string[]
}

export const SERVICES: Service[] = [
  // ── TABLE 1 — Year 1 Setup (template rows 1-10) ──────────────────────────────
  {
    key: 'INCORP', cat: 'table1', num: 1,
    en: 'Company Incorporation Service', cn: '公司注册服务',
    fee: 900, fee_type: 'onetime', fee_str: 'SGD 900.00', fee_note: 'One-time fee / 一次性',
    default: false, content_type: 'bullets',
    content: [
      ['Company KYC and background checks for all directors and shareholders', '客户背景调查和尽职调查'],
      ['Name application and Company registration including all government fees', '公司名字申请和成立（包括政府费用$315）'],
      ['Company related consultations', '公司相关咨询'],
      ['Company standard constitution', '公司章程（标准章程)'],
      ['Company Business profile (Bizfile)', '公司信息纸'],
      ['Preparation of First Board Meeting Minutes and Resolutions and related forms', '第一次股东大会决议文件和相关董事决议文件（涵盖其他公司设立相关文件）'],
      ['Company Self-ink stamp', '公司章'],
      ['Share Certificates', '股份证书'],
      ['Company Registers and other post incorporation documents', '公司注册簿和其他公司注册后文件'],
      ['Register of Controller and updates with government', '受益人申报'],
      ['Preparation of Bank opening Resolutions and assist in Bank opening', '开户董事决议文件准备/开户协助'],
      ['Company Personal Data Protection Support including appointment of DPO & Notice/Policy generation (additional fee will be incurred)', '公司个人数据保护支持，包括任命数据保护官（DPO）以及生成通知/政策'],
    ],
    table: 'main',
    table_desc: ['Company self-ink stamp  公司章', 'Statutory compliance filings — Nominee Director declaration, Nominee Shareholder declaration, Register of Controllers  合规申报', 'Certificate of Incorporation (1 copy)  公司成立证书（一份）'],
  },
  {
    key: 'SECRETARIAL', cat: 'table1', num: 2,
    en: 'Corporate Secretarial Services - Yearly', cn: '公司法定秘书服务（年费）',
    fee: 700, fee_type: 'yearly', fee_str: 'SGD 700.00', fee_note: 'Per year / 每年',
    default: false, content_type: 'bullets',
    content: [
      ['Safe custody of statutory records (e.g. register of shareholders, directors and secretaries, transfer, charges etc.)', '秘书档案建立和管理'],
      ['Preparing all documentation for the routine Annual General Meeting ("AGM") as required by the Singapore Companies Act', '根据《新加坡公司法1967》的要求，准备年度股东大会的文件'],
      ['Preparing and submitting electronically to ACRA the prescribed Annual Return', '提交年检'],
      ['Drafting of routine resolutions for matters such as bank accounts, change of secretary, registered address etc.', '配合公司发展需要准备相应的董事决议，例如银行账户开设/关闭帐户等事项'],
      ['Liaison with auditors/accountant for statutory review where applicable', '如若公司有审计要求，配合联系审计师或会计师安排审核秘书文件'],
      ['Attend to ad hoc requests including EGM, share allotment/transfer, ACRA lodgements etc. (additional fees may apply)', '应特别要求，包括特别股东大会（EGM）、股份分配、转让、ACRA申报等（附加费用视情况而异）'],
      ['Name as secretary of the Company (CPA qualified secretary named in ACRA Bizfile)', '担任公司秘书（我们的注册秘书的名字将显示在公司注册纸）'],
      ['Important dates notification during the year', '公司重要日期提醒'],
      ['Government updates notifications and compliance (e.g. Register of Controllers & KYC)', '政府条例和信息更新/咨询等（比如受益人申报的提交和更新）'],
    ],
    table: 'main',
    table_desc: ['Refer to Service 2 for full scope  详见第二项服务内容', 'Includes: important date reminders, statutory records, AGM documentation and Annual Return filing  包括：重要日期提醒、保存/更新公司记录、年度股东大会文件及年检递交', 'Excludes accounting and tax services  不含财税服务'],
  },
  {
    key: 'BANK', cat: 'table1', num: 3,
    en: 'Corporate Bank Account Opening Support', cn: '企业银行账户开户协助',
    fee: 1000, fee_type: 'onetime', fee_str: 'SGD 1,000.00', fee_note: 'One-time fee / 一次性',
    default: false, content_type: 'bullets',
    content: [
      ['Bank resolution preparation; service included in our incorporation service', '服务涵盖在开设公司'],
      ['Assist on bank opening including introduce different banks and help do assessment (UOB/OCBC/Standard Chartered/CIMB/DBS)', '如果只是基本户，没有其他银行费用；开户决议我们会准备并安排初步审核不同银行（UOB/OCBC/Standard Chartered/CIMB/DBS）'],
      ['Or with your own bank relationships, support on bank opening will be provided', '我们也会对接您自己委任的银行开户经理或者做开户的支持'],
    ],
    table: 'main',
    table_desc: ['Assistance with corporate bank account opening across major Singapore banks (UOB / OCBC / Standard Chartered / CIMB / DBS)  协助在新加坡主要银行开通企业账户', 'Declaration and lodgement of initial paid-up capital  呈报实缴注册资本金'],
  },
  {
    key: 'ADDRESS', cat: 'table1', num: 4,
    en: 'Registered Office and Mailing Address Services - Yearly', cn: '公司注册地址及收信服务（年费）',
    fee: 360, fee_type: 'yearly', fee_str: 'SGD 360.00', fee_note: 'Per year / 每年',
    default: false, content_type: 'bullets',
    content: [
      ['Registered address', '公司注册使用地址'],
      ['Mails checking/collection/scanning/emailing', '收信服务/扫描/邮件信件'],
      ['Postage or courier arrangement upon request', '根据客户要求安排邮递或快递'],
    ],
    table: 'main',
    table_desc: ['Registered office address for company use  公司注册使用地址', 'Mail collection, scanning and forwarding  信件收取、扫描及转发'],
  },
  {
    key: 'ND', cat: 'table1', num: 5,
    en: 'Local Nominee Director Service - Yearly', cn: '本地挂名董事服务（年费）',
    fee: 3000, fee_type: 'onetime', fee_str: 'SGD 3,000.00', fee_note: 'One-time fee / 一次性',
    default: false, content_type: 'bullets',
    content: [
      ['Being Named Local director in ACRA; Local Singaporean Director will be provided by us, and no operations will be involved', '在公司注册局上显示本地董事，以符合公司法基本要求'],
      ['Detailed refer to the Nominee Director Agreement drafted and finalized by our lawyer', '详细参考我们的律师草拟的合约《挂名董事协议》'],
      ['We also can involve lawyer review and consultations on our agreement where you have special conditions or requirements', '如果您在相互协议的基础上有特殊条件或要求，我们还可以对我们的协议进行律师审查和咨询'],
    ],
    table: 'main',
    table_desc: ['Provision of a qualified local Singaporean as Nominee Director in ACRA  委派专业人士在公司注册局（ACRA）担任本地挂名董事', 'No operational involvement; governed by Nominee Director Agreement  不参与公司运营，受挂名董事协议约束'],
  },
  {
    key: 'EP', cat: 'table1', num: 6,
    en: 'Employment Pass (EP) Application Service', cn: '就业准证（EP）申请服务',
    fee: 4000, fee_type: 'onetime', fee_str: 'SGD 4,000.00', fee_note: 'One-time fee / 一次性',
    default: false, content_type: 'paras',
    content: [
      ['Employment Pass ("EP") refers to a work pass issued by the Ministry of Manpower ("MOM") to eligible foreign professionals, managers, executives, and specialists working in Singapore.', '就业准证（"EP"）是由新加坡人力部（"MOM"）签发予符合资格之外国专业人士、管理人员、行政人员及专才的工作准证。'],
      ['assist the Company and/or applicant with the EP application process, including preliminary eligibility assessment and advisory, CorpPass application assistance where applicable, review and preparation of supporting documents, submission of EP application to MOM, posting of job advertisements where required, liaison with relevant authorities, submission of additional documents or appeals where necessary, and administrative support until issuance of the In-Principle Approval ("IPA") letter and receipt of the EP card.', '服务提供方将协助公司及/或申请人办理EP申请程序，包括申请资格初步评估及咨询、在适用情况下协助CorpPass申请、审核及准备相关申请文件、向MOM提交EP申请、按要求发布招聘广告（如需）、与相关政府机构沟通、在需要时提交补充文件或上诉，并提供行政支持直至获得原则性批准函（IPA）及领取EP准证卡。'],
      ['Where applicable, the Service Provider may also provide related corporate administrative coordination and advisory support in connection with the EP application process.', '在适用情况下，服务提供方亦可就EP申请相关事宜提供企业行政协调及咨询支持服务。'],
    ],
    table: 'main',
    table_desc: ['EP application submission via MOM-licensed agent  通过人力部执照递交EP申请', 'Preparation of supporting documents (employment contract, cover letter, CV, service agreement, etc.)  申请支持文件协助准备', 'Online appointment booking and EP card collection  网上预约及签发EP卡', 'Accompany client to MOM for in-person registration (if required)  陪同客户前往人力部登记（如需）', 'Personal bank account setup assistance and advisory (if required)  个人账户协助开设及相关咨询（如需）'],
  },
  {
    key: 'POST_EP', cat: 'table1', num: 7,
    en: 'One-Time Post-EP Changes', cn: 'EP获批后一次性政府记录更新',
    fee: 0, fee_type: 'foc', fee_str: 'F.O.C.', fee_note: 'Included in package / 含在报价配套内',
    default: false, content_type: 'bullets',
    content: [],
    table: 'main',
    table_desc: [],
  },
  {
    key: 'CORPPASS', cat: 'table1', num: 8,
    en: 'CorpPass Account Registration', cn: '企业通行证（CorpPass）账号开通',
    fee: 0, fee_type: 'foc', fee_str: 'F.O.C.', fee_note: 'Included in package / 含在报价配套内',
    default: false, content_type: 'paras',
    content: [
      ["CorpPass is Singapore's official corporate digital identity platform, which allows companies and authorised users to access and transact with Singapore government agencies electronically.", 'CorpPass 是新加坡政府官方企业数字身份平台，用于公司及授权用户登录及办理各类政府机构电子服务。'],
      ['Assist the Company with the application, registration, setup, and activation of the Company\'s CorpPass account, including administrator/user setup.', '服务提供方将协助公司申请、注册、设立及启用CorpPass账户，包括管理员/用户设置权限等。'],
    ],
    table: 'main',
    table_desc: ['Application, registration, setup and activation of company CorpPass account, including administrator and user configuration  协助申请、注册、设立及启用CorpPass账户，包括管理员/用户设置'],
  },
  {
    key: 'PDPA', cat: 'table1', num: 9,
    en: 'PDPA Compliance - DPO Appointment', cn: '个人资料保护合规 - DPO任命及政策文件',
    fee: 0, fee_type: 'foc', fee_str: 'F.O.C.', fee_note: 'Included in package / 含在报价配套内',
    default: false, content_type: 'bullets',
    content: [],
    table: 'main',
    table_desc: [],
  },
  {
    key: 'CORP_CONSULT', cat: 'table1', num: 10,
    en: 'Corporate Consultation Support', cn: '企业咨询支持',
    fee: 0, fee_type: 'foc', fee_str: 'F.O.C.', fee_note: 'Included in package / 含在报价配套内',
    default: false, content_type: 'bullets',
    content: [],
    table: 'main',
    table_desc: [],
  },

  // ── TABLE 2 — Annual Maintenance (template rows 1-8) ─────────────────────────
  {
    key: 'ACCOUNTS', cat: 'table2', num: 11,
    en: 'Accounts Preparation - Yearly', cn: '年度做账服务',
    fee: 1500, fee_type: 'from', fee_str: 'From SGD 1,500', fee_note: 'Depending on business volume / 根据业务量',
    default: false, content_type: 'bullets',
    content: [
      ['Data processing of transactions based on client record and supporting documents', '基于客户记录和提供的做账文件的交易数据处理'],
      ['Preparing financial statements in the form of Trial Balance, Balance Sheet and Profit/Loss Account with supporting schedules', '以试算表，资产负债表和损益表的形式准备财务报表，并附上附表'],
      ['Preparing bank reconciliation', '准备银行对帐'],
      ['Preparing ageing accounts receivable/payable', '准备应收账款/应付账款'],
      ['Compiling general ledger', '编制总账'],
    ],
    table: 'optional',
    table_desc: ['Bookkeeping and financial data processing based on client records and supporting documents  基于客户记录及凭证的账务处理及财务数据整理', 'Fee varies according to volume of transactions  费用根据业务量调整'],
  },
  {
    key: 'AR', cat: 'table2', num: 12,
    en: 'Annual Return Services', cn: '年检+股东大会',
    fee: 60, fee_type: 'govt', fee_str: 'SGD 60.00', fee_note: 'Government fee / 政府费用',
    default: false, content_type: 'paras',
    content: [
      ['The Company shall hold its Annual General Meeting ("AGM") and file its Annual Return with the Accounting and Corporate Regulatory Authority ("ACRA") on a yearly basis in accordance with the Companies Act and prevailing ACRA requirements. Annual compliance records, including the Register of Controllers and KYC information, may also be reviewed and updated annually as required.', '公司须根据《公司法》及新加坡会计与企业管理局（"ACRA"）的现行规定，每年召开年度股东大会（"AGM"）并提交年度申报。公司合规资料，包括公司控制人登记册及KYC资料，亦可能按年度要求进行审查及更新。'],
    ],
    table: 'optional',
    table_desc: ['Preparation of AGM documentation and electronic filing of Annual Return with ACRA  准备年度股东大会文件及向ACRA电子提交年检申报', 'Government filing fee: SGD 60 (applicable separately)  政府申报费用：SGD 60（另行收取）'],
  },
  {
    key: 'UNAUDITEDFS', cat: 'table2', num: 13,
    en: 'Unaudit Report', cn: '非审计报告',
    fee: 700, fee_type: 'yearly', fee_str: 'SGD 700.00', fee_note: 'Per year / 每年',
    default: false, content_type: 'bullets',
    content: [
      ['Compile the financial statements of the company including directors\' statement and financial position as at Year end and statement of comprehensive income, statement of changes in equity and statement of cash flows for the financial year ended together with notes to accounts.', '编制公司的财务报表，包括截至年底的董事报表和财务状况，综合收益表，该会计年度结束时的权益变动表和现金流量表以及账目说明。'],
      ['We will not carry out audit and/or review engagement procedures in relation to such financial statements.', '我们不会对此类财务报表执行审计和/或审查委聘程序。'],
      ['Consequently, no assurance on the financial statements will be expressed.', '因此，此报告属于非审计报告，将不会对财务报表作出任何意见。'],
    ],
    table: 'optional',
    table_desc: ["Compilation of unaudited financial statements including directors' statement, balance sheet, income statement and cash flow statement  编制非审计财务报表，含董事报表、资产负债表、损益表及现金流量表"],
  },
  {
    key: 'COMPANYTAX', cat: 'table2', num: 14,
    en: 'Corporate Taxation', cn: '税务计算与申报',
    fee: 700, fee_type: 'yearly', fee_str: 'SGD 700.00', fee_note: 'Per year / 每年',
    default: false, content_type: 'bullets',
    content: [
      ["Preparing the Company's Income Tax Return and Computation together with supporting schedules in compliance with the Singapore Income Tax Act (\"the Tax Enactments\")", '根据《新加坡所得税法》（"税收法规"）的规定，准备公司的所得税申报表和计算表'],
      ['Reviewing tax status for claiming Tax Exemption, capital allowances, etc. where applicable', '审查税收状况以申请免税，资本津贴等（如适用）'],
      ['Verifying correctness of the Notices of Assessment and tax computation from the Inland Revenue Authority of Singapore', '验证新加坡税务局的评估通知和税收计算的正确性'],
      ['Updating the Company on recent tax changes', '更新公司关于税收政策的变化和告知相关政策信息'],
    ],
    table: 'optional',
    table_desc: ['Preparation of corporate income tax return and computation in compliance with the Singapore Income Tax Act  根据《新加坡所得税法》准备企业所得税申报表及计算表', 'Submission to the Inland Revenue Authority of Singapore (IRAS)  向新加坡税务局（IRAS）提交申报'],
  },
  {
    key: 'PERSONALTAX', cat: 'table2', num: 15,
    en: 'Personal Tax Submission', cn: '个人税务申报',
    fee: 300, fee_type: 'yearly', fee_str: 'SGD 300.00', fee_note: 'Per year / 每年  (1 director)',
    default: false, content_type: 'paras',
    content: [
      ['Personal Tax Support Service refers to administrative assistance provided for the preparation and submission of individual income tax returns to the Inland Revenue Authority of Singapore ("IRAS").', '个人税务支持服务是指协助准备及向新加坡税务局（"IRAS"）提交个人所得税申报的行政支持服务。'],
      ['The Service Provider shall assist eligible individuals with the preparation and submission of individual income tax returns to IRAS, including the compilation and review of income information and supporting documents.', '服务提供方将协助符合条件的个人准备及向IRAS提交个人所得税申报，包括整理及核对收入资料与相关证明文件，并提供与个人所得税申报相关的行政支持服务。'],
      ['The accuracy and completeness of all information and supporting documents provided shall remain the responsibility of the individual taxpayer.', '所有提供资料及证明文件的真实性、准确性及完整性，均由个人纳税人负责。'],
    ],
    table: 'optional',
    table_desc: ['Personal income tax return preparation and filing with IRAS  个人所得税申报表准备及向IRAS提交', 'Auto-Inclusion Scheme (AIS) account setup and employment income submission for 1 director  为1名董事开设及提交自动纳入计划（AIS）雇佣收入申报'],
  },
  {
    key: 'PAYROLL', cat: 'table2', num: 16,
    en: 'Payroll Service', cn: '工资服务',
    fee: 600, fee_type: 'yearly', fee_str: 'SGD 600.00', fee_note: 'SGD 50/month × 12  (up to 2 persons)',
    default: false, content_type: 'paras',
    content: [
      ['Payroll Service refers to payroll administration and statutory contribution services provided in accordance with the applicable laws and regulations of Singapore.', '薪资服务是指根据新加坡适用法律及法规提供的薪资管理及法定缴纳服务。'],
      ['assist the Company with monthly payroll processing, including salary computation, preparation and issuance of payslips, CPF and Skills Development Levy ("SDL") submission, as well as administrative support relating to payroll records and statutory payroll compliance matters.', '协助公司处理每月薪资事务，包括薪资计算、薪水单出具、中央公积金（CPF）及技能发展税（SDL）申报，以及与薪资记录及法定薪资合规事项相关的行政支持服务。'],
      ["The Company shall ensure timely payment of employees' salaries in accordance with the applicable payroll schedule and statutory requirements.", '公司须根据适用薪资安排及法定要求，按时向员工发放薪资。'],
    ],
    table: 'optional',
    table_desc: ['Monthly payroll processing, payslip issuance, CPF and Skills Development Levy (SDL) submission  每月薪资处理、薪水单出具、公积金（CPF）及技能发展税（SDL）申报', 'SGD 30 per additional headcount beyond 2 persons  超过2人每增加一人加收SGD 30'],
  },

  // ── TABLE 3 — EP / Work Pass (template rows 1-4) ─────────────────────────────
  {
    key: 'PASSRENEWAL', cat: 'table3', num: 17,
    en: 'EP Renewal Service', cn: 'EP 续约（每2年一次）',
    fee: 1800, fee_type: 'onetime', fee_str: 'SGD 1,800.00', fee_note: 'Inclusive of Government fee / 含政府费用',
    default: false, content_type: 'paras',
    content: [
      ['Work Pass Renewal Service refers to administrative assistance provided for the renewal of work passes issued by the Ministry of Manpower ("MOM"), including Employment Pass ("EP"), S Pass, and Dependant\'s Pass ("DP"), where applicable.', '工作准证续签服务是指协助办理由新加坡人力部（MOM）签发之工作准证续签的行政支持服务，包括就业准证（EP）、S Pass及家属准证（DP）等（如适用）。'],
      ['assist the Company and/or applicant with the renewal process of the relevant work pass, including review and preparation of supporting documents, eligibility assessment and advisory, submission of renewal application to MOM, liaison with relevant authorities, submission of additional documents where required, and administrative support until approval and receipt of the renewed pass card.', '服务提供方将协助公司及/或申请人办理相关工作准证续签程序，包括审核及准备相关申请文件、资格评估及咨询、向MOM提交续签申请、与相关政府机构沟通、在需要时提交补充文件，并提供行政支持直至续签获批及领取新准证卡。'],
    ],
    table: 'ep',
    table_desc: ['Full EP renewal application process including document preparation and MOM submission (every 2 years)  包括文件准备及向人力部提交的完整EP续签申请流程（每2年一次）'],
  },
  {
    key: 'DP', cat: 'table3', num: 18,
    en: 'DP Application', cn: '家属准证申请',
    fee: 800, fee_type: 'per_person', fee_str: 'SGD 800.00', fee_note: 'Per applicant / 每位',
    default: false, content_type: 'paras',
    content: [
      ["Dependant's Pass (\"DP\") refers to a pass issued by the Ministry of Manpower (\"MOM\") to eligible family members of Employment Pass or S Pass holders residing in Singapore.", '家属准证（"DP"）是由新加坡人力部（"MOM"）签发予EP或S Pass持有人符合资格之家属于新加坡居留的准证。'],
      ['assist the Company and/or applicant with the DP application process, including review and preparation of supporting documents, submission of DP application to MOM, liaison with relevant authorities, submission of additional documents where required, and administrative support until issuance of the In-Principle Approval ("IPA") letter and receipt of the DP card.', '服务提供方将协助公司及/或申请人办理DP申请程序，包括审核及准备相关申请文件、向MOM提交DP申请、与相关政府机构沟通、在需要时提交补充文件，并提供行政支持直至获得原则性批准函（IPA）及领取DP准证卡。'],
    ],
    table: 'ep',
    table_desc: ["Full DP application process for eligible family members of EP / S Pass holders  为EP/S Pass持有人符合资格之家属办理完整DP申请流程"],
  },
  {
    key: 'LOC', cat: 'table3', num: 19,
    en: 'Letter of Consent (LOC) Application', cn: '工作许可同意书（LOC）申请',
    fee: 200, fee_type: 'per_person', fee_str: 'SGD 200.00', fee_note: 'Per applicant / 每位',
    default: false, content_type: 'paras',
    content: [
      ['Letter of Consent ("LOC") for Secondary Directorship refers to the formal authorization granted by the Ministry of Manpower ("MOM") allowing an Employment Pass ("EP") holder to be appointed as a director in a related or investment-linked entity.', '兼任董事工作许可同意书（"LOC"）是指由新加坡人力部（"MOM"）签发的正式授权，允许就业准证（"EP"）持有人在关联公司或具有投资关系的实体中担任董事职务。'],
      ['assist the Company and/or applicant with the LOC application process, including assessment of corporate nexus and eligibility, review and preparation of statutory supporting documents, submission of the LOC application to MOM, liaison with relevant authorities for technical clarifications, and administrative support until the formal issuance of the LOC.', '服务提供方将协助公司及/或申请人办理LOC申请程序，包括评估公司关联性及申请资格、审核及准备法定证明文件、向MOM提交LOC申请、就技术性查询与相关政府机构沟通，并提供行政支持直至LOC正式签发。'],
    ],
    table: 'ep',
    table_desc: ['Comprehensive application service for DP Business Owners or EP Secondary Directorships, including compliance advisory and statutory document drafting  为DP企业主或EP兼任董事提供完整的申请服务'],
  },
  {
    key: 'EP_SDL', cat: 'table3', num: 20,
    en: 'EP Monthly SDL', cn: '技能发展津贴',
    fee: 135, fee_type: 'yearly', fee_str: 'SGD 135.00', fee_note: 'SGD 11.25/month × 12 / 每月新币11.25',
    default: false, content_type: 'bullets',
    content: [],
    table: 'ep',
    table_desc: [],
  },

  // ── ADDITIONAL — not in fee tables but may be included as service sections ────
  {
    key: 'XBRL', cat: 'extra', num: 21,
    en: 'XBRL Reporting Service', cn: '转换和准备XBRL报告',
    fee: null, fee_type: 'quote', fee_str: 'Quote', fee_note: 'Based on company structure',
    default: false, content_type: 'paras',
    content: [
      ['Full XBRL is required for a company with corporate shareholder. Partial XBRL is required for a company with net liability position. Other companies not compulsorily for XBRL services.', '如果是具有公司股东或者净负债的公司，XBRL是强制性的。有企业股东的公司需要做完整XBRL格式，净负债公司需要做部分XBRL格式的报告；除外，其他公司不强制提交XBRL形式的报告。'],
      ['XBRL stands for eXtensible Business Reporting Language. It is a language for the electronic communication of business and financial data worldwide.', 'XBRL代表可增强的业务报告语言。它是全球商业和财务数据电子通信的一种语言。'],
    ],
    table: 'optional',
    table_desc: ['XBRL conversion and reporting based on company structure  XBRL报告转换，依据公司股权结构而定'],
  },
  {
    key: 'AUDIT', cat: 'extra', num: 22,
    en: 'Auditing Services', cn: '公司审计',
    fee: null, fee_type: 'quote', fee_str: 'Quote', fee_note: 'Quote once year end and accounts done',
    default: false, content_type: 'bullets',
    content: [
      ['Auditing standards Singapore will be complied; auditor will express opinion in the audit report', '将遵循新加坡的审计标准，并且审计师将在审计报告中表达意见。'],
      ['Company under small group can exempt from audit; once year end, our accountant will approach you for detailed confirmation', '小集团公司可以免除审计，每年年底，我们的会计师将与您联系以进行详细确认'],
      ['Audit exemption criteria (must meet 2 of 3): consolidated revenue ≤ S$10M; total assets ≤ S$10M; ≤ 50 employees', '审计豁免条件（满足以下3个条件中的2个）：财政年度总收入≤1000万新币；总资产≤1000万新币；总员工人数≤50人'],
    ],
    table: 'optional',
    table_desc: ['Quote provided once year-end financials and accounts are completed  待年底财务账目完成后提供报价'],
  },
  {
    key: 'AIS', cat: 'extra', num: 23,
    en: 'AIS/IR8A Services', cn: '员工年收入申报',
    fee: null, fee_type: 'bundled', fee_str: 'Bundled', fee_note: 'Included with Personal Tax / 含在个人税服务中',
    default: false, content_type: 'paras',
    content: [
      ['AIS (Auto-Inclusion Scheme) is an electronic employment income submission scheme administered by the Inland Revenue Authority of Singapore ("IRAS"), under which participating employers submit employees\' employment income information directly to IRAS electronically.', 'AIS（自动纳入计划）是由新加坡税务局（"IRAS"）实施的电子雇佣收入申报制度，参与该计划的雇主须以电子方式直接向IRAS提交员工雇佣收入资料。'],
      ['Pursuant to prevailing IRAS requirements, employers with five (5) or more employees are required to participate in the AIS programme. For employers not participating in AIS, IR8A forms shall be prepared and issued to employees for individual income tax filing purposes.', '根据IRAS现行规定，拥有五（5）名或以上员工的雇主必须参加AIS计划。如雇主未参与AIS计划，则须准备并向员工发出IR8A表格，以供员工办理个人所得税申报之用。'],
    ],
    table: 'optional',
    table_desc: ['AIS account setup and employment income submission  自动纳入计划账户开设及雇佣收入申报', 'IR8A preparation where AIS not applicable  IR8A表格准备（不参与AIS计划时适用）'],
  },
]

export const CATEGORIES: [string, string][] = [
  ['table1', 'Table 1 — Year 1 Setup Services  第一年服务'],
  ['table2', 'Table 2 — Annual Maintenance  年度维护服务'],
  ['table3', 'Table 3 — EP / Work Pass  工作准证服务'],
  ['extra',  'Additional Services  补充服务'],
]

export const SERVICE_MAP: Record<string, Service> = Object.fromEntries(SERVICES.map(s => [s.key, s]))

export const MAIN_FEES: Record<string, number> = {
  INCORP: 900, SECRETARIAL: 700, ADDRESS: 360, ND: 3000, EP: 4000, BANK: 1000,
}
export const OPT_FEES: Record<string, number> = {
  ACCOUNTS: 1500, SECRETARIAL: 700, ADDRESS: 360, AR: 60,
  UNAUDITEDFS: 700, COMPANYTAX: 700, PERSONALTAX: 300, PAYROLL: 600,
}

export const TEMPLATE_ORDER = [
  'INCORP', 'SECRETARIAL', 'BANK', 'ADDRESS', 'ND',
  'EP', 'DP', 'LOC', 'AR', 'XBRL',
  'ACCOUNTS', 'UNAUDITEDFS', 'AUDIT', 'COMPANYTAX', 'CORPPASS',
  'AIS', 'PAYROLL', 'PERSONALTAX', 'PASSRENEWAL',
]

export const ROW_DEFS: Record<string, { table: string; label: string; match: string }> = {
  // ── Table 1 (main) ── match strings verified against V2026.0528 template
  MAIN_INCORP:     { table: 'main', label: 'Company Incorporation Service',                   match: 'Company Incorporation Service' },
  MAIN_SEC:        { table: 'main', label: 'Corporate Secretarial Services – Yearly',          match: 'Corporate Secretarial Services' },
  MAIN_BANK:       { table: 'main', label: 'Corporate Bank Account Opening Support',           match: 'Corporate Bank Account Opening' },
  MAIN_ADDR:       { table: 'main', label: 'Registered Office and Mailing Address – Yearly',  match: 'Registered Office and Mailing Address' },
  MAIN_ND:         { table: 'main', label: 'Local Nominee Director Service',                   match: 'Nominee Director' },
  MAIN_ND_DEPOSIT: { table: 'main', label: 'Additional Deposit (ND sub-row)',                  match: 'Additional Deposit' },
  MAIN_EP:         { table: 'main', label: 'Employment Pass (EP) Application Service',         match: 'Employment Pass (EP) Application' },
  MAIN_POST_EP:    { table: 'main', label: 'One-Time Post-EP Changes (FOC)',                   match: 'One-Time Post-EP' },
  MAIN_CORPPASS:   { table: 'main', label: 'CorpPass Account Registration (FOC)',              match: 'CorpPass Account Registration' },
  MAIN_PDPA:       { table: 'main', label: 'PDPA Compliance — DPO Appointment (FOC)',         match: 'PDPA Compliance' },
  // ── Table 2 (opt) ── match strings verified against V2026.0528 template
  OPT_ACCOUNTS:    { table: 'opt',  label: 'Accounts Preparation – Yearly',                   match: 'Accounts Preparation' },
  OPT_SECRETARIAL: { table: 'opt',  label: 'Secretarial Services – Yearly',                   match: 'Secretarial Services' },
  OPT_ADDRESS:     { table: 'opt',  label: 'Registered Mailing Address – Yearly',             match: 'Registered mailing Address' },
  OPT_AR_GOV:      { table: 'opt',  label: 'Annual Return Services',                          match: 'Annual Return Services' },
  OPT_UFS:         { table: 'opt',  label: 'Unaudit Report',                                  match: 'Unaudit Report' },
  OPT_CORPTAX:     { table: 'opt',  label: 'Corporate Taxation',                              match: 'Corporate Taxation' },
  OPT_PERSONALTAX: { table: 'opt',  label: 'Personal Tax Filing + AIS',                      match: 'Personal tax submission' },
  OPT_PAYROLL:     { table: 'opt',  label: 'Payroll Service',                                 match: 'Payroll service' },
  // ── Table 3 (ep) ── match strings verified against V2026.0528 template
  EP_RENEW:        { table: 'ep',   label: 'EP Renewal Service',                              match: 'EP renewal service' },
  EP_DP:           { table: 'ep',   label: "DP Application",                                  match: 'DP Application' },
  EP_LOC:          { table: 'ep',   label: 'Letter of Consent (LOC) Application',             match: 'Letter of Consent' },
  EP_SDL:          { table: 'ep',   label: 'EP Monthly SDL',                                  match: 'SDL' },
}

export const DEFAULT_MAPPING: Record<string, string[]> = {
  INCORP:       ['MAIN_INCORP'],
  SECRETARIAL:  ['MAIN_SEC', 'OPT_SECRETARIAL'],
  BANK:         ['MAIN_BANK'],
  ADDRESS:      ['MAIN_ADDR', 'OPT_ADDRESS'],
  ND:           ['MAIN_ND', 'MAIN_ND_DEPOSIT'],
  EP:           ['MAIN_EP'],
  POST_EP:      ['MAIN_POST_EP'],
  CORPPASS:     ['MAIN_CORPPASS'],
  PDPA:         ['MAIN_PDPA'],
  CORP_CONSULT: [],
  ACCOUNTS:     ['OPT_ACCOUNTS'],
  AR:           ['OPT_AR_GOV'],
  UNAUDITEDFS:  ['OPT_UFS'],
  AUDIT:        [],
  COMPANYTAX:   ['OPT_CORPTAX'],
  PERSONALTAX:  ['OPT_PERSONALTAX'],
  AIS:          ['OPT_PERSONALTAX'],
  PAYROLL:      ['OPT_PAYROLL'],
  PASSRENEWAL:  ['EP_RENEW'],
  DP:           ['EP_DP'],
  LOC:          ['EP_LOC'],
  EP_SDL:       ['EP_SDL'],
  XBRL:         [],
}

export const ROW_ID_TO_SVC: Record<string, string> = {
  MAIN_INCORP: 'INCORP', MAIN_SEC: 'SECRETARIAL', MAIN_ADDR: 'ADDRESS',
  MAIN_ND: 'ND', MAIN_EP: 'EP', MAIN_BANK: 'BANK',
  OPT_ACCOUNTS: 'ACCOUNTS', OPT_SECRETARIAL: 'SECRETARIAL', OPT_ADDRESS: 'ADDRESS',
  OPT_AR_GOV: 'AR', OPT_UFS: 'UNAUDITEDFS', OPT_CORPTAX: 'COMPANYTAX',
  OPT_PERSONALTAX: 'PERSONALTAX', OPT_PAYROLL: 'PAYROLL',
  EP_RENEW: 'PASSRENEWAL', EP_DP: 'DP', EP_LOC: 'LOC', EP_SDL: 'EP_SDL',
}
