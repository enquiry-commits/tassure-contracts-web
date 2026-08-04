import crypto from 'crypto'

// Test SSO token generation and verification
const SSO_SHARED_SECRET = 'your-shared-secret-here'
const email = 'esther@tassure.com'
const exp = Math.floor(Date.now() / 1000) + 300 // 5 minutes from now

const payload = `${email}:${exp}`
const signature = crypto
  .createHmac('sha256', SSO_SHARED_SECRET)
  .update(payload)
  .digest('hex')

const token = `${payload}:${signature}`
console.log('Generated SSO token:')
console.log(token)
console.log('\nUse this URL in tassure-invoice:')
console.log(`http://localhost:3000/api/sso?token=${token}`)
