// Shared reference data in three languages.
// Status chips: one word; the API code goes in the tooltip (dictionary keys status.<code> / statusTip.<code>).
// Error reference: drawer reason cards and #/help/errors. Help articles: slugs for page-help links.

export const STATUS_CODES = ['queued', 'ringing', 'in-progress', 'completed', 'no-answer', 'busy', 'failed', 'canceled', 'rejected'];
export const STATUS_TONE = { queued: '', ringing: 'warn', 'in-progress': 'info', completed: 'ok', 'no-answer': 'warn', busy: 'warn', failed: 'err', canceled: '', rejected: 'err', playing: 'info' };

export const ERRORS = [
  { code: 'SIP 480 · Q.850 19', text: { en: 'No answer within 30 seconds · retried as set in the campaign', th: 'ไม่มีผู้รับสายภายใน 30 วินาที · ระบบโทรซ้ำตามที่ตั้งไว้', zh: '30 秒内无人接听 · 将按设置重拨' } },
  { code: 'SIP 480 · Q.850 20', text: { en: 'Phone switched off or out of coverage · try later', th: 'ปลายทางปิดเครื่องหรืออยู่นอกพื้นที่บริการ · ลองใหม่ภายหลัง', zh: '对方关机或不在服务区 · 请稍后再试' } },
  { code: 'SIP 486 · Q.850 17', text: { en: 'Line busy · retried as set', th: 'สายไม่ว่าง · ระบบโทรซ้ำตามที่ตั้งไว้', zh: '对方忙线 · 将按设置重拨' } },
  { code: 'SIP 603 · Q.850 21', text: { en: 'The recipient declined the call', th: 'ผู้รับกดตัดสาย', zh: '对方拒接' } },
  { code: 'SIP 404 · Q.850 1', text: { en: 'Number not in service · remove it from your list', th: 'หมายเลขนี้ไม่มีผู้ใช้บริการ · ควรลบออกจากรายชื่อ', zh: '号码为空号 · 请从名单中删除' } },
  { code: 'SIP 503 · Q.850 34', text: { en: 'The mobile network was temporarily unavailable · not charged · we retry automatically, on the backup route if needed', th: 'เครือข่ายปลายทางไม่พร้อมชั่วคราว · ไม่คิดเงิน · ระบบโทรซ้ำให้อัตโนมัติ (ใช้เส้นทางสำรองหากจำเป็น)', zh: '对方网络暂时不可用 · 不收费 · 系统将自动重拨（必要时走备用线路）' } },
  { code: 'SIP 487', text: { en: 'Canceled before answer (by your API request, your PBX or the caller)', th: 'ยกเลิกก่อนมีผู้รับสาย (จากคำขอ API ตู้สาขา หรือผู้โทร)', zh: '接听前已取消（API 请求、PBX 或主叫方）' } },
  { code: 'VOICE_4201', text: { en: 'Not enough credits · top up', th: 'เครดิตไม่พอ · เติมเครดิต', zh: '点数不足 · 请充值' } },
  { code: 'VOICE_4202', text: { en: 'International calling is off · request access in Billing', th: 'ปิดการโทรต่างประเทศอยู่ · ขอเปิดได้ที่บิลและเครดิต', zh: '国际呼叫未开通 · 可在账单页申请' } },
  { code: 'VOICE_4203', text: { en: "Sandbox: this number isn't verified · verify it or go live", th: 'โหมดทดสอบ: เบอร์นี้ยังไม่ได้ยืนยัน · ยืนยันเบอร์ หรือเปิดใช้งานจริง', zh: '沙盒：该号码未验证 · 请验证或切换到正式环境' } },
  { code: 'VOICE_4204', text: { en: 'On your Do-Not-Call list · not dialled', th: 'อยู่ในรายชื่อห้ามโทร · ระบบไม่ได้โทรออก', zh: '在免打扰名单中 · 未拨出' } },
  { code: 'VOICE_4205', text: { en: 'Outside calling hours · moved to the next window', th: 'นอกเวลาที่อนุญาตให้โทร · เลื่อนไปช่วงเวลาถัดไป', zh: '不在允许拨打时段 · 顺延至下一时段' } },
  { code: 'VOICE_4206', text: { en: 'Daily spending limit reached · new calls blocked until 00:00 · raise the limit', th: 'ถึงเพดานใช้จ่ายรายวันแล้ว · ระงับสายใหม่ถึง 00:00 น. · ปรับเพดานได้', zh: '已达每日消费上限 · 00:00 前暂停新呼叫 · 可提高上限' } },
  { code: 'VOICE_4207', text: { en: 'Already called this number the maximum times today', th: 'โทรหาเบอร์นี้ครบจำนวนครั้งต่อวันแล้ว', zh: '今日拨打该号码次数已达上限' } },
  { code: 'VOICE_4220', text: { en: 'Number format not valid · use 10 digits starting with 0 (08x-xxx-xxxx) or +66 followed by 9 digits', th: 'รูปแบบหมายเลขไม่ถูกต้อง · ใช้ 10 หลักขึ้นต้นด้วย 0 (08x-xxx-xxxx) หรือ +66 ตามด้วย 9 หลัก', zh: '号码格式不正确 · 请使用以 0 开头的 10 位号码（08x-xxx-xxxx）或 +66 加 9 位数字' } },
  { code: 'VOICE_5010', text: { en: "Your PBX didn't answer OPTIONS · check firewall, IP allow-list and TLS 5061", th: 'ตู้สาขาไม่ตอบ OPTIONS · ตรวจไฟร์วอลล์ รายการ IP และพอร์ต TLS 5061', zh: 'PBX 未响应 OPTIONS · 请检查防火墙、IP 白名单和 TLS 5061' } },
  { code: 'HTTP 401', text: { en: 'API key missing, wrong or revoked', th: 'ไม่มีคีย์ คีย์ผิด หรือถูกเพิกถอน', zh: 'API 密钥缺失、错误或已吊销' } },
];

/** Help center articles. Bodies are the Help builder's; titles are shared so page-help links read well. */
export const ARTICLES = [
  { slug: 'first-call', cat: 'start', title: { en: 'Make your first call in 10 minutes', th: 'โทรสายแรกภายใน 10 นาที', zh: '10 分钟内拨出第一通电话' } },
  { slug: 'sandbox-rules', cat: 'start', title: { en: "Sandbox and trial: what's free and what's limited", th: 'โหมดทดสอบและการทดลองใช้: อะไรฟรี อะไรจำกัด', zh: '沙盒与试用：哪些免费、哪些受限' } },
  { slug: 'verify-number', cat: 'start', title: { en: 'Verify a mobile number for testing', th: 'ยืนยันเบอร์มือถือสำหรับทดสอบ', zh: '验证用于测试的手机号码' } },
  { slug: 'api-quickstart-otp', cat: 'api', title: { en: 'Send a voice OTP with the API', th: 'ส่ง OTP ทางเสียงผ่าน API', zh: '通过 API 发送语音验证码' } },
  { slug: 'api-quickstart-notify', cat: 'api', title: { en: 'Send a notification call', th: 'โทรแจ้งเตือนผ่าน API', zh: '发送语音通知电话' } },
  { slug: 'click-to-call', cat: 'api', title: { en: 'Connect your staff and a customer (click-to-call)', th: 'เชื่อมพนักงานกับลูกค้า (click-to-call)', zh: '连接员工与客户（点击通话）' } },
  { slug: 'campaign-guide', cat: 'campaigns', title: { en: 'Run a reminder campaign', th: 'ส่งแคมเปญโทรแจ้งเตือน', zh: '发起提醒外呼活动' } },
  { slug: 'calling-hours-dnc', cat: 'campaigns', title: { en: 'Calling hours, Do-Not-Call and opt-out', th: 'เวลาที่โทรได้ รายชื่อห้ามโทร และการขอไม่รับสาย', zh: '拨打时段、免打扰名单与退订' } },
  { slug: 'pbx-freepbx', cat: 'pbx', pbx: 'FreePBX', title: { en: 'Connect FreePBX to ANTS', th: 'เชื่อมตู้สาขา FreePBX กับ ANTS', zh: '将 FreePBX 连接到 ANTS' } },
  { slug: 'pbx-3cx', cat: 'pbx', pbx: '3CX', title: { en: 'Connect 3CX to ANTS', th: 'เชื่อมตู้สาขา 3CX กับ ANTS', zh: '将 3CX 连接到 ANTS' } },
  { slug: 'pbx-yeastar', cat: 'pbx', pbx: 'Yeastar', title: { en: 'Connect Yeastar to ANTS', th: 'เชื่อมตู้สาขา Yeastar กับ ANTS', zh: '将 Yeastar 连接到 ANTS' } },
  { slug: 'pbx-asterisk', cat: 'pbx', pbx: 'Asterisk', title: { en: 'Connect Asterisk to ANTS', th: 'เชื่อมตู้สาขา Asterisk กับ ANTS', zh: '将 Asterisk 连接到 ANTS' } },
  { slug: 'trunk-troubleshooting', cat: 'pbx', title: { en: 'Trunk shows "Down": OPTIONS, firewall and NAT', th: 'ทรังก์ขึ้นว่า "ขัดข้อง": OPTIONS ไฟร์วอลล์ และ NAT', zh: '中继显示"故障"：OPTIONS、防火墙与 NAT' } },
  { slug: 'thai-number-kyc', cat: 'numbers', title: { en: 'Get a Thai number: documents and timing', th: 'ขอเบอร์ไทย: เอกสารและระยะเวลา', zh: '申请泰国号码：资料与时间' } },
  { slug: 'loa-caller-id', cat: 'numbers', title: { en: 'Show your existing 02 number as caller ID (LOA)', th: 'ใช้เบอร์ 02 เดิมเป็นเบอร์โทรออก (หนังสือมอบอำนาจ)', zh: '使用现有 02 号码作为主叫号码（授权书）' } },
  { slug: 'flows-guide', cat: 'flows', title: { en: 'Build a phone menu (press 1, 2, 3)', th: 'สร้างเมนูเสียงกด 1 2 3', zh: '创建按键语音菜单' } },
  { slug: 'call-statuses', cat: 'logs', title: { en: 'What each call status means', th: 'สถานะสายแต่ละแบบหมายถึงอะไร', zh: '各通话状态的含义' } },
  { slug: 'error-codes', cat: 'logs', title: { en: 'Error and SIP code reference', th: 'รหัสข้อผิดพลาดและรหัส SIP', zh: '错误码与 SIP 码对照' } },
  { slug: 'answer-rate-tips', cat: 'logs', title: { en: 'Why calls go unanswered in Thailand, and how to fix it', th: 'ทำไมลูกค้าไม่รับสาย และวิธีแก้', zh: '为什么电话没人接，以及如何改善' } },
  { slug: 'webhooks-signature', cat: 'api', title: { en: 'Verify webhook signatures', th: 'ตรวจสอบลายเซ็นเว็บฮุก', zh: '校验 Webhook 签名' } },
  { slug: 'billing-credits', cat: 'billing', title: { en: 'How credits, per-minute billing and invoices work', th: 'เครดิต การคิดเงินต่อนาที และใบแจ้งหนี้', zh: '点数、按分钟计费与发票说明' } },
  { slug: 'spending-limits', cat: 'billing', title: { en: 'Daily and monthly spending limits', th: 'เพดานใช้จ่ายรายวันและรายเดือน', zh: '每日与每月消费上限' } },
  { slug: 'volume-plans', cat: 'billing', title: { en: 'Volume plans with a 12-month commitment', th: 'แพ็กเกจปริมาณ สัญญา 12 เดือน', zh: '12 个月承诺用量套餐' } },
  { slug: 'recording-pdpa', cat: 'compliance', title: { en: 'Recording notice and retention', th: 'ข้อความแจ้งบันทึกเสียงและระยะเวลาเก็บ', zh: '录音提示与保存期限' } },
  { slug: 'roles', cat: 'account', title: { en: 'Roles and permissions', th: 'บทบาทและสิทธิ์', zh: '角色与权限' } },
  { slug: 'support-sla', cat: 'account', title: { en: 'Support hours, priorities and service target', th: 'เวลาให้บริการ ลำดับความสำคัญ และเป้าหมายบริการ', zh: '支持时间、优先级与服务目标' } },
];

/** Page-help slug per screen (shell.pagehelp). */
export const PAGE_HELP = { overview: 'first-call', connect: 'api-quickstart-notify', 'test-call': 'first-call', numbers: 'thai-number-kyc', trunks: 'trunk-troubleshooting', otp: 'api-quickstart-otp', campaigns: 'campaign-guide', flows: 'flows-guide', logs: 'call-statuses', reports: 'answer-rate-tips', alerts: 'spending-limits', billing: 'billing-credits', users: 'roles', keys: 'webhooks-signature', settings: 'recording-pdpa', help: 'support-sla' };
