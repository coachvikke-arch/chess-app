export default function academyBase(pathname) {
  return pathname.startsWith('/admin') ? '/admin/openings' : '/student/openings';
}