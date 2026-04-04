import { prisma } from '#config/prisma.js';

async function seedPricing() {
  const pricingData = [
    {
      plan: 'BASIC',
      label: 'Basic Plan',
      unit_price: 14900, // ₹149 per card per year (paise)
      renewal_price: 9900,
      advance_percent: 50,
      is_active: true,
    },
    {
      plan: 'PREMIUM',
      label: 'Premium Plan',
      unit_price: 19900, // ₹199 per card per year (paise)
      renewal_price: 12900,
      advance_percent: 50,
      is_active: true,
    },
  ];

  for (const data of pricingData) {
    await prisma.pricingConfig.upsert({
      where: { plan: data.plan },
      update: data,
      create: data,
    });
  }

  console.log('✅ PricingConfig seeded');
}

seedPricing()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
