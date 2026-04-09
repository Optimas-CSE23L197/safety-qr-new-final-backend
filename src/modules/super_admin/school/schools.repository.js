// =============================================================================
// schools.repository.js — RESQID Super Admin Schools
// Database operations for school management
// =============================================================================

import { prisma } from '#config/prisma.js';
import { generateSchoolCode } from '#shared/utils/schoolCodeGenerator.js';
import { createHash } from 'crypto';

const PASSWORD_PEPPER =
  process.env.PASSWORD_PEPPER || 'resqid-super-admin-pepper-2026-change-in-production';

function pepperAndHashPassword(hashedPasswordFromFrontend) {
  // Frontend sends SHA-256 hash, add pepper and re-hash
  const peppered = hashedPasswordFromFrontend + PASSWORD_PEPPER;
  return createHash('sha256').update(peppered).digest('hex');
}

export class SchoolsRepository {
  async getSchoolsList(filters, pagination, sorting) {
    const { search, city, subscription_status, status } = filters;
    const { skip, take } = pagination;
    const { sort_field, sort_dir } = sorting;

    const where = {};

    if (search) {
      const sanitizedSearch = search.replace(/[^a-zA-Z0-9\s]/g, '');
      where.OR = [
        { name: { contains: sanitizedSearch, mode: 'insensitive' } },
        { code: { contains: sanitizedSearch, mode: 'insensitive' } },
        { city: { contains: sanitizedSearch, mode: 'insensitive' } },
      ];
    }

    if (city) {
      where.city = { equals: city, mode: 'insensitive' };
    }

    if (status === 'active') {
      where.is_active = true;
    } else if (status === 'inactive') {
      where.is_active = false;
    }

    if (subscription_status) {
      where.subscriptions = {
        some: {
          status: subscription_status,
          NOT: { status: 'CANCELED' },
        },
      };
    }

    const orderBy = {};
    if (sort_field === 'students') {
      orderBy.students = { _count: sort_dir };
    } else {
      orderBy[sort_field] = sort_dir;
    }

    const schools = await prisma.school.findMany({
      where,
      skip,
      take,
      orderBy,
      select: {
        id: true,
        name: true,
        code: true,
        city: true,
        state: true,
        is_active: true,
        created_at: true,
        _count: {
          select: {
            students: true,
            users: {
              where: { role: 'ADMIN' },
            },
          },
        },
        subscriptions: {
          where: { status: { not: 'CANCELED' } },
          orderBy: { created_at: 'desc' },
          take: 1,
          select: { status: true, plan: true },
        },
      },
    });

    const total = await prisma.school.count({ where });

    return { schools, total };
  }

  async getSchoolById(id) {
    return prisma.school.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            students: true,
            users: true,
            subscriptions: true,
          },
        },
        subscriptions: {
          orderBy: { created_at: 'desc' },
          take: 1,
          select: { status: true, plan: true, current_period_end: true },
        },
        settings: true,
      },
    });
  }

  async toggleSchoolStatus(id, isActive) {
    return prisma.school.update({
      where: { id },
      data: { is_active: isActive },
      select: { id: true, name: true, is_active: true },
    });
  }

  async getSchoolsStats() {
    const [total, active] = await Promise.all([
      prisma.school.count(),
      prisma.school.count({ where: { is_active: true } }),
    ]);

    return { total, active, inactive: total - active };
  }

  async getUniqueCities() {
    const cities = await prisma.school.findMany({
      where: { city: { not: null } },
      distinct: ['city'],
      select: { city: true },
      orderBy: { city: 'asc' },
    });
    return cities.map(c => c.city).filter(Boolean);
  }

  async checkRecentRegistration(schoolEmail, adminEmail) {
    const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
    const existing = await prisma.school.findFirst({
      where: {
        OR: [{ email: schoolEmail }, { users: { some: { email: adminEmail } } }],
        created_at: { gte: thirtySecondsAgo },
      },
    });
    return !!existing;
  }

  async generateUniqueSchoolCode(name, city, retryCount = 0) {
    const maxRetries = 3;

    const lastSchool = await prisma.school.findFirst({
      orderBy: { serial_number: 'desc' },
      select: { serial_number: true },
    });
    const nextSerial = (lastSchool?.serial_number || 0) + 1;

    let schoolCode = generateSchoolCode(name, city, nextSerial);

    const existing = await prisma.school.findUnique({
      where: { code: schoolCode },
      select: { id: true },
    });

    if (existing && retryCount < maxRetries) {
      return this.generateUniqueSchoolCode(name, city, retryCount + 1);
    }

    if (existing) {
      schoolCode = `${schoolCode}_${Date.now().toString().slice(-6)}`;
    }

    return { code: schoolCode, serialNumber: nextSerial };
  }

  async createSchoolWithAdmin(data) {
    return prisma.$transaction(async tx => {
      const { code: schoolCode, serialNumber: nextSerial } = await this.generateUniqueSchoolCode(
        data.school.name,
        data.school.city
      );

      const school = await tx.school.create({
        data: {
          ...data.school,
          code: schoolCode,
          serial_number: nextSerial,
          setup_status: 'PENDING_SETUP',
        },
      });

      let pricing = null;
      if (data.subscription.plan !== 'CUSTOM') {
        pricing = await tx.pricingConfig.findUnique({ where: { plan: data.subscription.plan } });

        if (!pricing) {
          const defaultPrices = {
            BASIC: { unit_price: 14900, renewal_price: 14900, advance_percent: 50 },
            PREMIUM: { unit_price: 19900, renewal_price: 19900, advance_percent: 50 },
          };
          pricing = defaultPrices[data.subscription.plan];
        }
      }

      const unitPrice =
        data.subscription.plan === 'CUSTOM'
          ? data.subscription.custom_unit_price
          : pricing.unit_price;

      const renewalPrice =
        data.subscription.plan === 'CUSTOM'
          ? data.subscription.custom_renewal_price
          : pricing.renewal_price;

      const subscription = await tx.subscription.create({
        data: {
          school_id: school.id,
          plan: data.subscription.plan,
          unit_price_snapshot: unitPrice,
          renewal_price_snapshot: renewalPrice,
          advance_percent: pricing?.advance_percent || 50,
          is_custom_pricing: data.subscription.plan === 'CUSTOM',
          custom_price_note: data.subscription.plan === 'CUSTOM' ? 'Manual custom pricing' : null,
          custom_approved_by: data.subscription.plan === 'CUSTOM' ? data.admin.created_by : null,
          custom_approved_at: data.subscription.plan === 'CUSTOM' ? new Date() : null,
          is_pilot: data.subscription.is_pilot || false,
          pilot_expires_at: data.subscription.pilot_expires_at || null,
          pilot_converted_at: null,
          student_count: data.subscription.student_count,
          active_card_count: 0,
          grand_total: unitPrice * data.subscription.student_count,
          total_invoiced: 0,
          total_received: 0,
          balance_due: unitPrice * data.subscription.student_count,
          status: 'TRIALING',
          current_period_start: new Date(),
          current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          trial_ends_at: data.subscription.is_pilot
            ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            : null,
          fully_paid_at: null,
        },
      });

      // Apply pepper to password before storing
      const finalPasswordHash = pepperAndHashPassword(data.admin.password);

      const schoolUser = await tx.schoolUser.create({
        data: {
          school_id: school.id,
          email: data.admin.email,
          password_hash: finalPasswordHash,
          name: data.admin.name,
          role: 'ADMIN',
          is_primary: true,
          must_change_password: true,
          invited_by: data.admin.created_by,
          invite_sent_at: new Date(),
          invite_accepted_at: null,
          is_active: true,
          last_login_at: null,
        },
      });

      await tx.schoolAgreement.create({
        data: {
          school_id: school.id,
          subscription_id: subscription.id,
          agreed_by: data.admin.created_by,
          agreed_via: data.agreement.agreed_via,
          ip_address: data.agreement.ip_address || null,
          document_url: null,
          notes: null,
          is_active: true,
        },
      });

      return { school, subscription, schoolUser };
    });
  }

  async findSchoolByEmail(email) {
    if (!email) return null;
    return prisma.school.findFirst({
      where: { email: email },
    });
  }

  async findUserByEmail(email) {
    return prisma.schoolUser.findUnique({
      where: { email },
    });
  }
}
