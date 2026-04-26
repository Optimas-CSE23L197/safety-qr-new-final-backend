// src/templates/email/order-delivered.jsx
// Used for: Order delivered with final invoice note
// Props: { schoolName, orderNumber }
import React from 'react';
import { Html, Head, Body, Container, Section, Text, Heading, Link, Preview, Hr } from '@react-email/components';

const c = { white: '#ffffff', bg: '#f4f5f7', ink: '#1a1d2e', muted: '#5f6478', border: '#e2e5ee', accent: '#1a3570', accentLight: '#eef1fb', gold: '#d4a017', green: '#1a7a4a', greenLight: '#f0faf4' };
const s = {
    body: { backgroundColor: c.bg, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", margin: 0, padding: 0 },
    wrapper: { padding: '40px 16px' },
    card: { maxWidth: '480px', margin: '0 auto', backgroundColor: c.white, borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' },
    header: { backgroundColor: c.green, padding: '28px 32px', textAlign: 'center' },
    headerIcon: { fontSize: '36px', display: 'block', marginBottom: '8px' },
    headerTitle: { fontSize: '18px', fontWeight: '700', color: c.white, margin: 0 },
    bodySection: { padding: '32px' },
    greeting: { fontSize: '16px', color: c.ink, marginBottom: '12px', fontWeight: '600' },
    text: { fontSize: '14px', color: c.muted, lineHeight: '1.65', marginBottom: '20px' },
    orderBox: { backgroundColor: c.greenLight, border: `1px solid #b8e8cc`, borderRadius: '10px', padding: '20px 24px', marginBottom: '24px', textAlign: 'center' },
    orderLabel: { fontSize: '11px', fontWeight: '600', letterSpacing: '1px', textTransform: 'uppercase', color: c.green, display: 'block', marginBottom: '6px' },
    orderNum: { fontSize: '22px', fontWeight: '700', color: c.green, margin: 0 },
    stepsTitle: { fontSize: '13px', fontWeight: '600', color: c.ink, marginBottom: '12px' },
    step: { fontSize: '13px', color: c.muted, lineHeight: '1.6', marginBottom: '8px' },
    dashBtn: { display: 'block', backgroundColor: c.accent, color: c.white, fontSize: '14px', fontWeight: '600', padding: '12px 24px', borderRadius: '8px', textDecoration: 'none', textAlign: 'center', marginBottom: '24px' },
    hr: { borderColor: c.border, margin: '24px 0' },
    link: { color: c.accent, textDecoration: 'none', fontWeight: '500' },
    footer: { borderTop: `1px solid ${c.border}`, padding: '20px 32px', textAlign: 'center' },
    footerText: { fontSize: '12px', color: '#9ca1b0', lineHeight: '1.7', margin: 0 },
    footerLink: { color: '#9ca1b0', textDecoration: 'underline' },
};

export default function OrderDeliveredEmail({ schoolName = 'School', orderNumber = '' }) {
    return (
        <Html lang="en"><Head />
            <Preview>Order #{orderNumber} delivered — RESQID</Preview>
            <Body style={s.body}>
                <Section style={s.wrapper}>
                    <Container style={s.card}>
                        <Section style={s.header}>
                            <span style={s.headerIcon}>📦</span>
                            <Heading style={s.headerTitle}>Order Delivered!</Heading>
                        </Section>
                        <Section style={s.bodySection}>
                            <Text style={s.greeting}>Hi {schoolName},</Text>
                            <Text style={s.text}>Your RESQID cards have been delivered successfully. You can now activate and distribute them to students.</Text>
                            <Section style={s.orderBox}>
                                <span style={s.orderLabel}>Order</span>
                                <Text style={s.orderNum}>#{orderNumber}</Text>
                            </Section>
                            <Text style={s.stepsTitle}>Next steps:</Text>
                            <Text style={s.step}>① Log into your dashboard</Text>
                            <Text style={s.step}>② Activate cards for each student</Text>
                            <Text style={s.step}>③ Distribute physical cards to students</Text>
                            <Link href="https://admin.getresqid.in" style={s.dashBtn}>Activate Cards →</Link>
                            <Hr style={s.hr} />
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