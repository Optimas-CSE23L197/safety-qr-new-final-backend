// src/templates/email/order-confirmed.jsx
// Used for: Order confirmed with advance invoice
// Props: { schoolName, orderNumber, cardCount, amount }
import React from 'react';
import { Html, Head, Body, Container, Section, Text, Heading, Link, Preview, Hr } from '@react-email/components';

const c = { white: '#ffffff', bg: '#f4f5f7', ink: '#1a1d2e', muted: '#5f6478', border: '#e2e5ee', accent: '#1a3570', accentLight: '#eef1fb', gold: '#d4a017', green: '#1a7a4a', greenLight: '#f0faf4' };
const s = {
    body: { backgroundColor: c.bg, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", margin: 0, padding: 0 },
    wrapper: { padding: '40px 16px' },
    card: { maxWidth: '480px', margin: '0 auto', backgroundColor: c.white, borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' },
    header: { backgroundColor: c.accent, padding: '28px 32px', textAlign: 'center' },
    headerIcon: { fontSize: '36px', display: 'block', marginBottom: '8px' },
    headerTitle: { fontSize: '18px', fontWeight: '700', color: c.white, margin: 0 },
    bodySection: { padding: '32px' },
    greeting: { fontSize: '16px', color: c.ink, marginBottom: '12px', fontWeight: '600' },
    text: { fontSize: '14px', color: c.muted, lineHeight: '1.65', marginBottom: '20px' },
    summaryBox: { backgroundColor: c.accentLight, border: `1px solid ${c.border}`, borderRadius: '10px', padding: '20px 24px', marginBottom: '24px' },
    summaryRow: { display: 'flex', justifyContent: 'space-between', marginBottom: '10px' },
    summaryLabel: { fontSize: '13px', color: c.muted },
    summaryValue: { fontSize: '13px', color: c.ink, fontWeight: '600' },
    totalRow: { borderTop: `1px solid ${c.border}`, paddingTop: '10px', display: 'flex', justifyContent: 'space-between' },
    totalLabel: { fontSize: '14px', color: c.ink, fontWeight: '600' },
    totalValue: { fontSize: '16px', color: c.accent, fontWeight: '700' },
    statusBadge: { display: 'inline-block', backgroundColor: c.greenLight, border: `1px solid #b8e8cc`, borderRadius: '20px', padding: '4px 14px', fontSize: '12px', color: c.green, fontWeight: '600', marginBottom: '20px' },
    link: { color: c.accent, textDecoration: 'none', fontWeight: '500' },
    hr: { borderColor: c.border, margin: '24px 0' },
    footer: { borderTop: `1px solid ${c.border}`, padding: '20px 32px', textAlign: 'center' },
    footerText: { fontSize: '12px', color: '#9ca1b0', lineHeight: '1.7', margin: 0 },
    footerLink: { color: '#9ca1b0', textDecoration: 'underline' },
};

export default function OrderConfirmedEmail({ schoolName = 'School', orderNumber = '', cardCount = 0, amount = '0' }) {
    return (
        <Html lang="en"><Head />
            <Preview>Order #{orderNumber} confirmed — RESQID</Preview>
            <Body style={s.body}>
                <Section style={s.wrapper}>
                    <Container style={s.card}>
                        <Section style={s.header}>
                            <span style={s.headerIcon}>✅</span>
                            <Heading style={s.headerTitle}>Order Confirmed</Heading>
                        </Section>
                        <Section style={s.bodySection}>
                            <Text style={s.greeting}>Hi {schoolName},</Text>
                            <Text style={s.text}>Your RESQID card order has been confirmed. We'll begin processing your order shortly.</Text>
                            <span style={s.statusBadge}>✓ Confirmed</span>
                            <Section style={s.summaryBox}>
                                <Section style={s.summaryRow}>
                                    <Text style={s.summaryLabel}>Order Number</Text>
                                    <Text style={s.summaryValue}>#{orderNumber}</Text>
                                </Section>
                                <Section style={s.summaryRow}>
                                    <Text style={s.summaryLabel}>Cards</Text>
                                    <Text style={s.summaryValue}>{cardCount} students</Text>
                                </Section>
                                <Section style={s.totalRow}>
                                    <Text style={s.totalLabel}>Advance Amount</Text>
                                    <Text style={s.totalValue}>{amount}</Text>
                                </Section>
                            </Section>
                            <Text style={s.text}>Our team will reach out with next steps. You can track your order from the <Link href="https://admin.getresqid.in" style={s.link}>dashboard</Link>.</Text>
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