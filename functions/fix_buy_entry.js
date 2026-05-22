'use strict'
// One-time script: corrects the 2026-05-08 buy entry from navpu 47.34 → 47.44
// Run from functions/ after setting GOOGLE_APPLICATION_CREDENTIALS:
//   $env:GOOGLE_APPLICATION_CREDENTIALS = ".\serviceAccount.json"
//   node fix_buy_entry.js

const admin = require('firebase-admin')
admin.initializeApp({ projectId: 'alfm-tracker' })
const db = admin.firestore()

const TARGET_DATE = '2026-05-08'
const CORRECT_NAVPU = 47.44
const AMOUNT = 1000

async function main() {
  // 1. Find the buy document
  const snap = await db.collection('buys')
    .where('date', '==', TARGET_DATE)
    .where('amount', '==', AMOUNT)
    .get()

  if (snap.empty) {
    console.error('No buy found for', TARGET_DATE, '₱', AMOUNT)
    process.exit(1)
  }
  if (snap.size > 1) {
    console.error('Multiple buys found — narrow the query manually')
    process.exit(1)
  }

  const buyDoc = snap.docs[0]
  const buy = buyDoc.data()
  console.log('Found buy doc:', buyDoc.id)
  console.log('Current:', buy)

  const oldUnitsBought = buy.unitsBought
  const newUnitsBought = parseFloat((AMOUNT / CORRECT_NAVPU).toFixed(4))
  const delta = newUnitsBought - oldUnitsBought

  const newTotalUnitsAfter = parseFloat((buy.totalUnitsAfter + delta).toFixed(4))
  const newAvgPrice = parseFloat((buy.totalCostAfter / newTotalUnitsAfter).toFixed(4))

  console.log(`\nCorrections:`)
  console.log(`  navpu:          ${buy.navpu} → ${CORRECT_NAVPU}`)
  console.log(`  unitsBought:    ${oldUnitsBought} → ${newUnitsBought}`)
  console.log(`  totalUnitsAfter:${buy.totalUnitsAfter} → ${newTotalUnitsAfter}`)
  console.log(`  newAvgPrice:    ${buy.newAvgPrice} → ${newAvgPrice}`)

  // 2. Update buy document
  await buyDoc.ref.update({
    navpu: CORRECT_NAVPU,
    unitsBought: newUnitsBought,
    totalUnitsAfter: newTotalUnitsAfter,
    newAvgPrice: newAvgPrice,
  })
  console.log('\nBuy document updated.')

  // 3. Update position (adjust by delta units; totalCost unchanged)
  const posSnap = await db.collection('position').doc('current').get()
  if (!posSnap.exists) {
    console.warn('No position document found — skipping position update.')
    return
  }
  const pos = posSnap.data()
  const newPosUnits = parseFloat((pos.units + delta).toFixed(4))
  const newPosAvgPrice = parseFloat((pos.totalCost / newPosUnits).toFixed(4))
  const newMarketValue = parseFloat((newPosUnits * CORRECT_NAVPU).toFixed(2))
  const newUnrealizedGain = parseFloat((newMarketValue - pos.totalCost).toFixed(2))
  const newUnrealizedGainPct = parseFloat(((newUnrealizedGain / pos.totalCost) * 100).toFixed(4))

  console.log(`\nPosition corrections:`)
  console.log(`  units:    ${pos.units} → ${newPosUnits}`)
  console.log(`  avgPrice: ${pos.avgPrice} → ${newPosAvgPrice}`)

  await db.collection('position').doc('current').update({
    units: newPosUnits,
    avgPrice: newPosAvgPrice,
    marketValue: newMarketValue,
    unrealizedGain: newUnrealizedGain,
    unrealizedGainPct: newUnrealizedGainPct,
  })
  console.log('Position document updated.')
  console.log('\nDone.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
