// src/templates/email/otp-parent.jsx
// Used for: Parent email verification OTP
// Props: { userName, otpCode, expiryMinutes }
import React from 'react';
import {
    Html, Head, Body, Container, Section,
    Text, Heading, Hr, Link, Preview,
} from '@react-email/components';

const c = {
    white: '#ffffff', bg: '#f4f5f7', ink: '#1a1d2e', muted: '#5f6478',
    border: '#e2e5ee', accent: '#1a3570', accentLight: '#eef1fb',
    gold: '#d4a017', red: '#c0392b',
};
const s = {
    body: { backgroundColor: c.bg, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", margin: 0, padding: 0 },
    wrapper: { padding: '40px 16px' },
    card: { maxWidth: '480px', margin: '0 auto', backgroundColor: c.white, borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' },
    header: { backgroundColor: c.accent, padding: '32px 36px', textAlign: 'center' },
    logo: { fontSize: '22px', fontWeight: '700', color: c.white, letterSpacing: '0.5px', margin: 0 },
    logoDot: { color: c.gold },
    bodySection: { padding: '36px' },
    greeting: { fontSize: '16px', color: c.ink, marginBottom: '8px', fontWeight: '600' },
    intro: { fontSize: '14px', color: c.muted, lineHeight: '1.65', marginBottom: '28px' },
    otpBox: { backgroundColor: c.accentLight, border: `1px solid ${c.border}`, borderRadius: '10px', padding: '24px', textAlign: 'center', marginBottom: '24px' },
    otpLabel: { fontSize: '11px', fontWeight: '600', letterSpacing: '1.5px', textTransform: 'uppercase', color: c.muted, marginBottom: '12px', display: 'block' },
    otpCode: { fontSize: '42px', fontWeight: '700', color: c.accent, letterSpacing: '8px', lineHeight: '1', marginBottom: '12px', display: 'block' },
    otpTimer: { display: 'inline-block', backgroundColor: c.white, border: `1px solid ${c.border}`, borderRadius: '20px', padding: '6px 16px', fontSize: '12px', color: c.muted },
    warningBox: { backgroundColor: '#fff9f5', borderLeft: `3px solid ${c.red}`, borderRadius: '0 8px 8px 0', padding: '12px 16px', marginBottom: '28px' },
    warningText: { fontSize: '12.5px', color: '#6b2a10', lineHeight: '1.55', margin: 0 },
    helpText: { fontSize: '13px', color: c.muted, lineHeight: '1.6', marginBottom: '4px' },
    link: { color: c.accent, textDecoration: 'none', fontWeight: '500' },
    hr: { borderColor: c.border, margin: '24px 0' },
    footer: { padding: '0 36px 32px', textAlign: 'center' },
    footerText: { fontSize: '12px', color: '#9ca1b0', lineHeight: '1.7', margin: 0 },
    footerLink: { color: '#9ca1b0', textDecoration: 'underline' },
};

export default function OtpParentEmail({ userName = 'Parent', otpCode = '000000', expiryMinutes = 5 }) {
    return (
        <Html lang="en"><Head />
            <Preview>Your RESQID verification code is {otpCode}</Preview>
            <Body style={s.body}>
                <Section style={s.wrapper}>
                    <Container style={s.card}>
                        <Section style={s.header}>
                            <Heading style={s.logo}>RESQID<span style={s.logoDot}>.</span></Heading>
                        </Section>
                        <Section style={s.bodySection}>
                            <Text style={s.greeting}>Hi {userName},</Text>
                            <Text style={s.intro}>Use the verification code below to verify your email address and complete your RESQID account setup.</Text>
                            <Section style={s.otpBox}>
                                <span style={s.otpLabel}>Your Verification Code</span>
                                <span style={s.otpCode}>{otpCode}</span>
                                <span style={s.otpTimer}>⏱ Valid for {expiryMinutes} minutes</span>
                            </Section>
                            <Section style={s.warningBox}>
                                <Text style={s.warningText}><strong>Do not share this code.</strong> RESQID will never ask for your verification code via phone, email, or chat.</Text>
                            </Section>
                            <Hr style={s.hr} />
                            <Text style={s.helpText}>Need help? <Link href="mailto:support@getresqid.in" style={s.link}>support@getresqid.in</Link></Text>
                        </Section>
                        <Section style={s.footer}>
                            <Text style={s.footerText}>© {new Date().getFullYear()} coreZ Technologies Pvt. Ltd.<br /><Link href="https://getresqid.in/privacy" style={s.footerLink}>Privacy</Link> · <Link href="https://getresqid.in/terms" style={s.footerLink}>Terms</Link></Text>
                        </Section>
                    </Container>
                </Section>
            </Body>
        </Html>
    );
}