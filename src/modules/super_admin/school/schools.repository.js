// =============================================================================
// schools.repository.js — RESQID Super Admin Schools
// Database operations for school management
// =============================================================================

import { prisma } from '#config/prisma.js';
import { generateSchoolCode } from '#shared/utils/schoolCodeGenerator.js';
import bcrypt from 'bcrypt';

export class SchoolsRepository {
  async getSchoolsList(filters, pagination, sorting) {
    const { search, city, subscription_status, status } = filters;
    const { skip, take } = pagination;
    const { sort_field, sort_dir } = sorting;

    const where = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
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

    const orderBy = {};
    if (sort_field === 'students') {
      // Will handle in JS due to aggregation
      orderBy.created_at = sort_dir;
    } else {
      orderBy[sort_field] = sort_dir;
    }

    const schools = await prisma.school.findMany({
      where,
      skip,
      take,
      orderBy: sort_field === 'students' ? { created_at: sort_dir } : orderBy,
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

    let filteredSchools = schools;

    if (subscription_status) {
      filteredSchools = schools.filter(
        school => school.subscriptions[0]?.status === subscription_status
      );
    }

    if (sort_field === 'students') {
      filteredSchools.sort((a, b) => {
        const aCount = a._count.students;
        const bCount = b._count.students;
        return sort_dir === 'asc' ? aCount - bCount : bCount - aCount;
      });
    }

    const total = await prisma.school.count({ where });

    return { schools: filteredSchools, total };
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

  async createSchoolWithAdmin(data) {
    return prisma.$transaction(async tx => {
      const lastSchool = await tx.school.findFirst({
        orderBy: { serial_number: 'desc' },
        select: { serial_number: true },
      });
      const nextSerial = (lastSchool?.serial_number || 0) + 1;

      const schoolCode = generateSchoolCode(data.school.name, data.school.city, nextSerial);

      const school = await tx.school.create({
        data: {
          ...data.school,
          code: schoolCode,
          serial_number: nextSerial,
          setup_status: 'PENDING_SETUP',
        },
      });

      const pricing =
        data.subscription.plan !== 'CUSTOM'
          ? await tx.pricingConfig.findUnique({ where: { plan: data.subscription.plan } })
          : null;

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
          custom_approved_by: data.admin.created_by,
          is_pilot: data.subscription.is_pilot,
          pilot_expires_at: data.subscription.pilot_expires_at,
          student_count: data.subscription.student_count,
          grand_total: unitPrice * data.subscription.student_count,
          status: 'TRIALING',
          current_period_start: new Date(),
          current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      const hashedPassword = await bcrypt.hash(data.admin.password, 10);

      const schoolUser = await tx.schoolUser.create({
        data: {
          school_id: school.id,
          email: data.admin.email,
          password_hash: hashedPassword,
          name: data.admin.name,
          role: 'ADMIN',
          is_primary: true,
          must_change_password: true,
          invited_by: data.admin.created_by,
          invite_sent_at: new Date(),
        },
      });

      await tx.schoolAgreement.create({
        data: {
          school_id: school.id,
          subscription_id: subscription.id,
          agreed_by: data.admin.created_by,
          agreed_via: data.agreement.agreed_via,
          ip_address: data.agreement.ip_address,
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
