// src/templates/email/anomaly-detected.jsx
// Used for: Unusual activity alert to parent
// Props: { studentName, anomalyType, location, detectedAt }
import React from 'react';
import { Html, Head, Body, Container, Section, Text, Heading, Link, Preview } from '@react-email/components';

const c = { white: '#ffffff', bg: '#f4f5f7', ink: '#1a1d2e', muted: '#5f6478', border: '#e2e5ee', accent: '#1a3570', amber: '#d4a017', amberLight: '#fffdf5', red: '#c0392b', redLight: '#fff5f5' };
const s = {
    body: { backgroundColor: c.bg, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", margin: 0, padding: 0 },
    wrapper: { padding: '40px 16px' },
    card: { maxWidth: '480px', margin: '0 auto', backgroundColor: c.white, borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' },
    header: { backgroundColor: c.amber, padding: '28px 32px', textAlign: 'center' },
    headerIcon: { fontSize: '36px', display: 'block', marginBottom: '8px' },
    headerTitle: { fontSize: '18px', fontWeight: '700', color: c.white, margin: 0 },
    bodySection: { padding: '32px' },
    greeting: { fontSize: '16px', color: c.ink, marginBottom: '12px', fontWeight: '600' },
    text: { fontSize: '14px', color: c.muted, lineHeight: '1.65', marginBottom: '20px' },
    anomalyBox: { backgroundColor: c.amberLight, border: `1px solid #f5e6b0`, borderRadius: '10px', padding: '16px 20px', marginBottom: '24px' },
    detailRow: { marginBottom: '10px' },
    detailLabel: { fontSize: '11px', fontWeight: '600', letterSpacing: '1px', textTransform: 'uppercase', color: c.muted, marginBottom: '2px', display: 'block' },
    detailValue: { fontSize: '14px', color: c.ink, fontWeight: '500', margin: 0 },
    warningBox: { backgroundColor: c.redLight, borderLeft: `3px solid ${c.red}`, borderRadius: '0 8px 8px 0', padding: '12px 16px', marginBottom: '24px' },
    warningText: { fontSize: '12.5px', color: '#6b2a10', lineHeight: '1.55', margin: 0 },
    link: { color: c.accent, textDecoration: 'none', fontWeight: '500' },
    footer: { borderTop: `1px solid ${c.border}`, padding: '20px 32px', textAlign: 'center' },
    footerText: { fontSize: '12px', color: '#9ca1b0', lineHeight: '1.7', margin: 0 },
    footerLink: { color: '#9ca1b0', textDecoration: 'underline' },
};

export default function AnomalyDetectedEmail({ studentName = 'Student', anomalyType = 'Unusual Activity', location = null, detectedAt = '' }) {
    return (
        <Html lang="en"><Head />
            <Preview>⚠️ Unusual activity detected on {studentName}'s card — RESQID</Preview>
            <Body style={s.body}>
                <Section style={s.wrapper}>
                    <Container style={s.card}>
                        <Section style={s.header}>
                            <span style={s.headerIcon}>⚠️</span>
                            <Heading style={s.headerTitle}>Unusual Activity Detected</Heading>
                        </Section>
                        <Section style={s.bodySection}>
                            <Text style={s.greeting}>Attention,</Text>
                            <Text style={s.text}>Unusual activity has been detected on {studentName}'s RESQID card. Please review the details below.</Text>
                            <Section style={s.anomalyBox}>
                                <Section style={s.detailRow}>
                                    <span style={s.detailLabel}>Student</span>
                                    <Text style={s.detailValue}>{studentName}</Text>
                                </Section>
                                <Section style={s.detailRow}>
                                    <span style={s.detailLabel}>Activity Type</span>
                                    <Text style={s.detailValue}>{anomalyType}</Text>
                                </Section>
                                {location && (
                                    <Section style={s.detailRow}>
                                        <span style={s.detailLabel}>Location</span>
                                        <Text style={s.detailValue}>{location}</Text>
                                    </Section>
                                )}
                                <Section style={{ ...s.detailRow, marginBottom: 0 }}>
                                    <span style={s.detailLabel}>Detected At</span>
                                    <Text style={s.detailValue}>{detectedAt}</Text>
                                </Section>
                            </Section>
                            <Section style={s.warningBox}>
                                <Text style={s.warningText}>If this activity was not authorised, open the RESQID app and lock the card immediately. Contact us if you need assistance.</Text>
                            </Section>
                            <Text style={s.text}>Need help? <Link href="mailto:support@getresqid.in" style={s.link}>support@getresqid.in</Link></Text>
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