'use strict'
// One-time script: writes correct dividend records for March 30 and April 29 2026,
// and removes any ghost dividend docs (missing divPerUnit) for those months.
// Run from functions/ after setting GOOGLE_APPLICATION_CREDENTIALS:
//   $env:GOOGLE_APPLICATION_CREDENTIALS = ".\serviceAccount.json"
//   node fix_dividends.js

const admin = require('firebase-admin')
admin.initializeApp({ projectId: 'alfm-tracker' })
const db = admin.firestore()

const RECORDS = [
  {
    date: '2026-03-30',
    month: 'Apr 2026',
    units: 4684.5062,
    divPerUnit: 0.0052,
    earned: parseFloat((4684.5062 * 0.0052).toFixed(4)),
    credited: '2026-04-20',
    autoDetected: false,
    estimated: false,
  },
  {
    date: '2026-04-29',
    month: 'May 2026',
    units: 4684.5062,
    divPerUnit: 0.0051,
    earned: parseFloat((4684.5062 * 0.0051).toFixed(4)),
    credited: '2026-05-18',
    autoDetected: false,
    estimated: false,
  },
]

async function main() {
  // 1. List all existing dividend docs so we can spot ghosts
  const allSnap = await db.collection('dividends').get()
  console.log(`\nExisting dividend docs (${allSnap.size}):`)
  allSnap.docs.forEach((d) => {
    const data = d.data()
    console.log(`  [${d.id}] month=${data.month} units=${data.units} divPerUnit=${data.divPerUnit} earned=${data.earned}`)
  })

  // 2. Delete ghost docs — no divPerUnit and no earned
  const ghosts = allSnap.docs.filter((d) => {
    const { divPerUnit, earned } = d.data()
    return !divPerUnit && !earned
  })
  if (ghosts.length > 0) {
    console.log(`\nDeleting ${ghosts.length} ghost doc(s):`)
    for (const g of ghosts) {
      console.log(`  Deleting [${g.id}]`)
      await g.ref.delete()
    }
  } else {
    console.log('\nNo ghost docs found.')
  }

  // 3. Write correct records (overwrites any existing doc at those dates)
  console.log('\nWriting correct records:')
  for (const rec of RECORDS) {
    console.log(`  [${rec.date}] month=${rec.month} units=${rec.units} divPerUnit=${rec.divPerUnit} earned=₱${rec.earned}`)
    await db.collection('dividends').doc(rec.date).set(rec)
  }

  console.log('\nDone.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
