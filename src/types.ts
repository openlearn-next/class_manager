/**
 * 班级与学生管理插件核心类型定义
 */

export interface ClassItem {
  id: string;
  name: string;
  code: string;
  grade?: string;
  description?: string;
  studentCount?: number;
  source?: 'host' | 'plugin';
  createdAt: number;
  updatedAt: number;
}

export interface StudentItem {
  id: string;
  classId: string;
  studentNo: string;
  name: string;
  gender?: 'male' | 'female' | 'other';
  groupId?: string;
  groupName?: string;
  points: number;
  tags?: string[];
  avatar?: string;
  createdAt: number;
}

export interface StudentGroup {
  id: string;
  classId: string;
  name: string;
  color?: string;
  leaderStudentId?: string;
  studentIds: string[];
  createdAt: number;
}

export type AttendanceStatus = 'present' | 'late' | 'leave' | 'absent';

export interface AttendanceRecord {
  id: string;
  classId: string;
  lessonId: string;
  studentId: string;
  studentName?: string;
  studentNo?: string;
  status: AttendanceStatus;
  remark?: string;
  timestamp: number;
}

export interface RollCallResult {
  id: string;
  classId: string;
  lessonId?: string;
  studentId: string;
  studentName: string;
  studentNo: string;
  timestamp: number;
  reason?: string;
}

export interface AttendanceAggregateStats {
  totalRecords: number;
  presentCount: number;
  lateCount: number;
  leaveCount: number;
  absentCount: number;
}

export interface PointsAggregateStats {
  avgPoints: number;
  maxPoints: number;
  minPoints: number;
  totalPoints: number;
}

export interface ClassSummaryReport {
  classId: string;
  className: string;
  totalStudents: number;
  totalGroups: number;
  attendanceRate: number;
  attendanceStats: AttendanceAggregateStats;
  pointsStats: PointsAggregateStats;
  topActiveStudents: { name: string; points: number }[];
  summaryText?: string;
}

