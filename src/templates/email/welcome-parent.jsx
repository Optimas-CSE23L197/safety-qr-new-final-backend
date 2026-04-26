// src/templates/email/welcome-parent.jsx
// Used for: Parent welcome after email verification
// Props: { parentName, phone, studentName, studentClass, schoolName, cardId, appStoreUrl, playStoreUrl }
import React from 'react';
import { Html, Head, Body, Container, Section, Text, Heading, Link, Preview, Hr } from '@react-email/components';

const c = { white: '#ffffff', bg: '#f4f5f7', ink: '#1a1d2e', muted: '#5f6478', border: '#e2e5ee', accent: '#1a3570', accentLight: '#eef1fb', gold: '#d4a017', green: '#1a7a4a', greenLight: '#f0faf4' };
const s = {
    body: { backgroundColor: c.bg, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", margin: 0, padding: 0 },
    wrapper: { padding: '40px 16px' },
    card: { maxWidth: '480px', margin: '0 auto', backgroundColor: c.white, borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' },
    header: { backgroundColor: c.accent, padding: '32px 36px', textAlign: 'center' },
    logo: { fontSize: '22px', fontWeight: '700', color: c.white, letterSpacing: '0.5px', margin: 0 },
    logoDot: { color: c.gold },
    tagline: { fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginTop: '4px', marginBottom: 0 },
    bodySection: { padding: '36px' },
    greeting: { fontSize: '16px', color: c.ink, marginBottom: '8px', fontWeight: '600' },
    text: { fontSize: '14px', color: c.muted, lineHeight: '1.65', marginBottom: '20px' },
    studentBox: { backgroundColor: c.greenLight, border: `1px solid #b8e8cc`, borderRadius: '10px', padding: '20px 24px', marginBottom: '24px' },
    studentLabel: { fontSize: '11px', fontWeight: '600', letterSpacing: '1px', textTransform: 'uppercase', color: c.green, marginBottom: '4px', display: 'block' },
    studentName: { fontSize: '22px', fontWeight: '700', color: c.green, margin: '0 0 8px' },
    studentMeta: { fontSize: '13px', color: c.muted, margin: 0 },
    cardBox: { backgroundColor: c.accentLight, border: `1px solid ${c.border}`, borderRadius: '10px', padding: '16px 20px', marginBottom: '24px', textAlign: 'center' },
    cardLabel: { fontSize: '11px', fontWeight: '600', letterSpacing: '1px', textTransform: 'uppercase', color: c.muted, display: 'block', marginBottom: '6px' },
    cardId: { fontSize: '18px', fontWeight: '700', color: c.accent, letterSpacing: '2px', margin: 0 },
    stepsTitle: { fontSize: '13px', fontWeight: '600', color: c.ink, marginBottom: '12px' },
    step: { fontSize: '13px', color: c.muted, lineHeight: '1.6', marginBottom: '8px', paddingLeft: '4px' },
    appRow: { textAlign: 'center', marginBottom: '28px' },
    appBtn: { display: 'inline-block', backgroundColor: c.accent, color: c.white, fontSize: '13px', fontWeight: '600', padding: '10px 20px', borderRadius: '8px', textDecoration: 'none', margin: '0 4px' },
    hr: { borderColor: c.border, margin: '24px 0' },
    link: { color: c.accent, textDecoration: 'none', fontWeight: '500' },
    footer: { borderTop: `1px solid ${c.border}`, padding: '20px 32px', textAlign: 'center' },
    footerText: { fontSize: '12px', color: '#9ca1b0', lineHeight: '1.7', margin: 0 },
    footerLink: { color: '#9ca1b0', textDecoration: 'underline' },
};

export default function WelcomeParentEmail({ parentName = 'Parent', phone = '', studentName = 'Student', studentClass = '', schoolName = '', cardId = null, appStoreUrl = 'https://apps.apple.com/app/resqid', playStoreUrl = 'https://play.google.com/store/apps/details?id=in.getresqid.app' }) {
    return (
        <Html lang="en"><Head />
            <Preview>Welcome to RESQID — {studentName}'s emergency ID is ready</Preview>
            <Body style={s.body}>
                <Section style={s.wrapper}>
                    <Container style={s.card}>
                        <Section style={s.header}>
                            <Heading style={s.logo}>RESQID<span style={s.logoDot}>.</span></Heading>
                            <Text style={s.tagline}>QR-based Student Emergency Identity</Text>
                        </Section>
                        <Section style={s.bodySection}>
                            <Text style={s.greeting}>Hi {parentName},</Text>
                            <Text style={s.text}>Welcome to RESQID. Your child's emergency ID profile is now active and ready to protect them.</Text>

                            <Section style={s.studentBox}>
                                <span style={s.studentLabel}>Linked Profile</span>
                                <Text style={s.studentName}>{studentName}</Text>
                                <Text style={s.studentMeta}>{studentClass ? `${studentClass} · ` : ''}{schoolName}</Text>
                            </Section>

                            {cardId && (
                                <Section style={s.cardBox}>
                                    <span style={s.cardLabel}>Card ID</span>
                                    <Text style={s.cardId}>{cardId}</Text>
                                </Section>
                            )}

                            <Text style={s.stepsTitle}>Get started in 2 steps:</Text>
                            <Text style={s.step}>① Download the RESQID parent app</Text>
                            <Text style={s.step}>② Log in with your phone number — your child's profile is already linked</Text>

                            <Section style={s.appRow}>
                                <Link href={playStoreUrl} style={s.appBtn}>Google Play</Link>
                                <Link href={appStoreUrl} style={s.appBtn}>App Store</Link>
                            </Section>

                            <Hr style={s.hr} />
                            <Text style={s.text}>Questions? <Link href="mailto:support@getresqid.in" style={s.link}>support@getresqid.in</Link></Text>
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