// =============================================================================
// modules/notification/notification.repository.js — RESQID
// All DB queries needed by the notification module.
// No business logic here — pure data fetching only.
// =============================================================================

import { prisma } from '#config/prisma.js';

// ─── Parent ───────────────────────────────────────────────────────────────────

export async function getParentNotificationData(parentId) {
  return prisma.parentUser.findUnique({
    where: { id: parentId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      studentLinks: {
        take: 1,
        orderBy: { is_primary: 'desc' },
        select: {
          is_primary: true,
          student: {
            select: {
              id: true,
              first_name: true,
              class: true,
              card_number: true,
              school: { select: { id: true, name: true } },
              tokens: {
                take: 1,
                orderBy: { created_at: 'desc' },
                select: {
                  cards: { take: 1, select: { card_number: true } },
                },
              },
            },
          },
        },
      },
      devices: {
        where: { is_active: true },
        select: { expo_push_token: true },
      },
    },
  });
}

export async function getParentContactInfo(parentId) {
  return prisma.parentUser.findUnique({
    where: { id: parentId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      devices: {
        where: { is_active: true },
        select: { expo_push_token: true },
      },
    },
  });
}

// ─── School ───────────────────────────────────────────────────────────────────

export async function getSchoolUserNotificationData(schoolUserId) {
  return prisma.schoolUser.findUnique({
    where: { id: schoolUserId },
    select: {
      id: true,
      name: true,
      email: true,
      school: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          subscription: {
            select: {
              plan: true,
              current_period_end: true,
              student_count: true,
              status: true,
            },
          },
        },
      },
    },
  });
}

export async function getSchoolNotificationData(schoolId) {
  return prisma.school.findUnique({
    where: { id: schoolId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      subscription: {
        select: {
          plan: true,
          current_period_end: true,
          status: true,
        },
      },
      users: {
        where: { is_active: true },
        take: 1,
        orderBy: { created_at: 'asc' },
        select: {
          id: true,
          name: true,
          email: true,
          devices: {
            where: { is_active: true },
            select: { expo_push_token: true },
          },
        },
      },
    },
  });
}

export async function getSchoolAdminExpoTokens(schoolId) {
  const users = await prisma.schoolUser.findMany({
    where: { school_id: schoolId, is_active: true },
    select: {
      devices: {
        where: { is_active: true },
        select: { expo_push_token: true },
      },
    },
  });
  return users.flatMap(u => u.devices.map(d => d.expo_push_token)).filter(Boolean);
}

// ─── Student ──────────────────────────────────────────────────────────────────

export async function getStudentNotificationData(studentId) {
  return prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      first_name: true,
      class: true,
      card_number: true,
      school: { select: { id: true, name: true } },
      tokens: {
        orderBy: { created_at: 'desc' },
        take: 1,
        select: { id: true, expires_at: true, status: true },
      },
      parentLinks: {
        select: {
          parent: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true, // ← ADD THIS
              devices: {
                where: { is_active: true },
                select: { expo_push_token: true },
              },
            },
          },
        },
      },
    },
  });
}

// ─── Order ────────────────────────────────────────────────────────────────────

export async function getOrderNotificationData(orderId) {
  return prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      order_number: true,
      student_count: true,
      grand_total: true,
      advance_amount: true,
      school_id: true,
      school: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
      shipment: {
        select: {
          tracking_id: true,
          tracking_url: true,
          courier_name: true,
          delivery_phone: true,
        },
      },
      finalInvoice: {
        select: {
          id: true,
          total_amount: true,
          amount: true,
        },
      },
      partialInvoice: {
        select: {
          id: true,
          total_amount: true,
          amount: true,
        },
      },
    },
  });
}
