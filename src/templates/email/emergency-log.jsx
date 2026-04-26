// src/templates/email/emergency-log.jsx
// Used for: Admin emergency report sent to coreZ team + school after emergency dispatch
// Props: { studentName, schoolName, location, scannedAt, dispatchResults }
import React from 'react';
import { Html, Head, Body, Container, Section, Text, Heading, Link, Preview, Hr } from '@react-email/components';

const c = { white: '#ffffff', bg: '#f4f5f7', ink: '#1a1d2e', muted: '#5f6478', border: '#e2e5ee', accent: '#1a3570', red: '#c0392b', redLight: '#fff5f5', green: '#1a7a4a', greenLight: '#f0faf4' };
const s = {
    body: { backgroundColor: c.bg, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", margin: 0, padding: 0 },
    wrapper: { padding: '40px 16px' },
    card: { maxWidth: '480px', margin: '0 auto', backgroundColor: c.white, borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' },
    header: { backgroundColor: c.red, padding: '28px 32px', textAlign: 'center' },
    headerIcon: { fontSize: '36px', display: 'block', marginBottom: '8px' },
    headerTitle: { fontSize: '18px', fontWeight: '700', color: c.white, margin: 0 },
    headerSub: { fontSize: '12px', color: 'rgba(255,255,255,0.75)', marginTop: '4px', marginBottom: 0 },
    bodySection: { padding: '32px' },
    sectionTitle: { fontSize: '11px', fontWeight: '600', letterSpacing: '1px', textTransform: 'uppercase', color: c.muted, marginBottom: '12px', display: 'block' },
    infoBox: { backgroundColor: c.redLight, border: `1px solid #f5d0d0`, borderRadius: '10px', padding: '16px 20px', marginBottom: '24px' },
    detailRow: { marginBottom: '10px' },
    detailLabel: { fontSize: '11px', fontWeight: '600', color: c.muted, display: 'block', marginBottom: '2px' },
    detailValue: { fontSize: '14px', color: c.ink, fontWeight: '500', margin: 0 },
    channelRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${c.border}` },
    channelName: { fontSize: '13px', color: c.ink, fontWeight: '500' },
    badgeSuccess: { fontSize: '11px', fontWeight: '600', color: c.green, backgroundColor: c.greenLight, border: `1px solid #b8e8cc`, padding: '2px 10px', borderRadius: '12px' },
    badgeFailed: { fontSize: '11px', fontWeight: '600', color: c.red, backgroundColor: c.redLight, border: `1px solid #f5d0d0`, padding: '2px 10px', borderRadius: '12px' },
    text: { fontSize: '14px', color: c.muted, lineHeight: '1.65', marginBottom: '20px' },
    hr: { borderColor: c.border, margin: '24px 0' },
    link: { color: c.accent, textDecoration: 'none', fontWeight: '500' },
    footer: { borderTop: `1px solid ${c.border}`, padding: '20px 32px', textAlign: 'center' },
    footerText: { fontSize: '12px', color: '#9ca1b0', lineHeight: '1.7', margin: 0 },
    footerLink: { color: '#9ca1b0', textDecoration: 'underline' },
};

export default function EmergencyLogEmail({ studentName = 'Student', schoolName = 'School', location = null, scannedAt = '', dispatchResults = {} }) {
    const channels = [
        { name: 'Push Notification', key: 'push' },
        { name: 'SMS', key: 'sms' },
        { name: 'WhatsApp', key: 'whatsapp' },
        { name: 'Voice Call', key: 'voice' },
    ];

    return (
        <Html lang="en"><Head />
            <Preview>[RESQID] Emergency Alert Report — {studentName}</Preview>
            <Body style={s.body}>
                <Section style={s.wrapper}>
                    <Container style={s.card}>
                        <Section style={s.header}>
                            <span style={s.headerIcon}>🚨</span>
                            <Heading style={s.headerTitle}>Emergency Alert Report</Heading>
                            <Text style={s.headerSub}>Internal dispatch log — RESQID</Text>
                        </Section>
                        <Section style={s.bodySection}>
                            <span style={s.sectionTitle}>Incident Details</span>
                            <Section style={s.infoBox}>
                                <Section style={s.detailRow}>
                                    <span style={s.detailLabel}>Student</span>
                                    <Text style={s.detailValue}>{studentName}</Text>
                                </Section>
                                <Section style={s.detailRow}>
                                    <span style={s.detailLabel}>School</span>
                                    <Text style={s.detailValue}>{schoolName}</Text>
                                </Section>
                                {location && (
                                    <Section style={s.detailRow}>
                                        <span style={s.detailLabel}>Location</span>
                                        <Text style={s.detailValue}>{typeof location === 'object' ? `${location.lat}, ${location.lng}` : location}</Text>
                                    </Section>
                                )}
                                <Section style={{ ...s.detailRow, marginBottom: 0 }}>
                                    <span style={s.detailLabel}>Scanned At</span>
                                    <Text style={s.detailValue}>{scannedAt}</Text>
                                </Section>
                            </Section>

                            <span style={s.sectionTitle}>Dispatch Results</span>
                            {channels.map(ch => {
                                const result = dispatchResults?.[ch.key];
                                if (!result) return null;
                                return (
                                    <Section key={ch.key} style={s.channelRow}>
                                        <Text style={s.channelName}>{ch.name}</Text>
                                        <span style={result.success ? s.badgeSuccess : s.badgeFailed}>
                                            {result.success ? '✓ Delivered' : '✗ Failed'}
                                        </span>
                                    </Section>
                                );
                            })}

                            <Hr style={s.hr} />
                            <Text style={s.text}>This is an automated report generated by RESQID for internal audit purposes.</Text>
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