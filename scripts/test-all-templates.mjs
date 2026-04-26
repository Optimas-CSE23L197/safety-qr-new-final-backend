// scripts/test-all-templates.mjs
// Test all email templates by rendering them first, then sending via Brevo

import { initializeEmail, getEmail } from '../src/infrastructure/email/email.index.js';
import { render } from '@react-email/components';
import React from 'react';

// Import all templates
import EmailChangedEmail from '../src/templates/email/email-changed.jsx';
import OtpParentEmail from '../src/templates/email/otp-parent.jsx';
import WelcomeParentEmail from '../src/templates/email/welcome-parent.jsx';
import CardLockedEmail from '../src/templates/email/card-locked.jsx';
import DeviceLoginEmail from '../src/templates/email/device-login.jsx';
import AnomalyDetectedEmail from '../src/templates/email/anomaly-detected.jsx';

initializeEmail();
const email = getEmail();

const TEST_EMAIL = 'shrutikumarimahata@gmail.com';

async function testTemplate(name, Component, props, subject) {
  console.log(`\n📧 Testing: ${name}...`);
  try {
    // Render the template using React.createElement
    const element = React.createElement(Component, props);
    const html = await render(element);
    const text = await render(element, { plainText: true });

    console.log(`   HTML length: ${html.length} chars`);
    console.log(`   Text length: ${text.length} chars`);

    // Send the email
    const result = await email.send({
      to: TEST_EMAIL,
      subject: `[TEST] ${subject}`,
      html,
      text,
    });

    if (result.success) {
      console.log(`   ✅ SENT! ID: ${result.id}`);
    } else {
      console.log(`   ❌ FAILED: ${result.error}`);
    }
    return result;
  } catch (err) {
    console.log(`   ❌ ERROR: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// Test all templates one by one
console.log('🚀 Starting template tests...\n');
console.log(`📬 Sending all test emails to: ${TEST_EMAIL}\n`);

const results = [];

// 1. Email Changed
results.push(
  await testTemplate(
    'EmailChanged',
    EmailChangedEmail,
    { parentName: 'Test Parent', oldEmail: 'old@example.com', newEmail: 'new@example.com' },
    'Email Address Changed - RESQID'
  )
);

// 2. OTP Parent
results.push(
  await testTemplate(
    'OtpParent',
    OtpParentEmail,
    { userName: 'Test Parent', otpCode: '123456', expiryMinutes: 5 },
    'Your Verification Code - RESQID'
  )
);

// 3. Welcome Parent
results.push(
  await testTemplate(
    'WelcomeParent',
    WelcomeParentEmail,
    {
      parentName: 'Test Parent',
      phone: '+919876543210',
      studentName: 'Test Student',
      studentClass: '5th Grade',
      schoolName: 'Test School',
      cardId: 'CARD-12345',
      appStoreUrl: 'https://apps.apple.com',
      playStoreUrl: 'https://play.google.com',
    },
    'Welcome to RESQID'
  )
);

// 4. Card Locked
results.push(
  await testTemplate(
    'CardLocked',
    CardLockedEmail,
    { parentName: 'Test Parent', studentName: 'Test Student' },
    'Safety Profile Locked - RESQID'
  )
);

// 5. Device Login
results.push(
  await testTemplate(
    'DeviceLogin',
    DeviceLoginEmail,
    {
      name: 'Test Parent',
      device: 'iPhone 15',
      location: 'Mumbai, India',
      time: 'Today at 10:30 AM',
    },
    'New Login Detected - RESQID'
  )
);

// 6. Anomaly Detected
results.push(
  await testTemplate(
    'AnomalyDetected',
    AnomalyDetectedEmail,
    {
      studentName: 'Test Student',
      anomalyType: 'Multiple scans in short time',
      location: 'School Gate',
      detectedAt: 'Today at 10:30 AM',
    },
    'Unusual Activity Detected - RESQID'
  )
);

// Summary
console.log('\n═══════════════════════════════════');
console.log('📊 TEST SUMMARY');
console.log('═══════════════════════════════════');
const passed = results.filter(r => r.success).length;
const failed = results.filter(r => !r.success).length;
console.log(`   ✅ Passed: ${passed}`);
console.log(`   ❌ Failed: ${failed}`);
console.log('═══════════════════════════════════\n');

process.exit(0);
