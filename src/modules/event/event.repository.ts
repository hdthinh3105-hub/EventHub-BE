// src/modules/event/event.repository.ts
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { CreateEventInput, UpdateEventInput, ListEventQuery } from './event.validation';

// --- Full-Text Search bằng Postgres native (thay thế Elasticsearch) ---
//
// Vì sao KHÔNG dùng "contains" (Prisma "LIKE %x%") cho search?
// "contains" chỉ so khớp CHUỖI CON thô - tìm "nhạc" sẽ khớp cả từ
// "âm nhạc" lẫn "nhạc nhiên" (không liên quan), và KHÔNG có khái niệm
// "mức độ liên quan" - kết quả không thể sắp xếp theo độ khớp tốt nhất
// lên đầu, chỉ sắp được theo ngày/tên như 1 filter thông thường.
//
// to_tsvector + plainto_tsquery là công cụ TÌM KIẾM VĂN BẢN THẬT của
// Postgres: tách từ (word), loại bỏ từ dừng (stopword), và ts_rank()
// tính điểm liên quan dựa trên tần suất/vị trí từ khóa xuất hiện -
// đúng bản chất 1 "search engine" thu nhỏ, không phải so khớp chuỗi.
//
// Dùng $queryRaw vì Prisma Client (tính tới hiện tại) CHƯA hỗ trợ cú
// pháp Full-Text Search của Postgres qua query builder thông thường -
// đây là 1 trong số ít nơi hợp lý để viết raw SQL thay vì Prisma API.
async function searchEventIds(searchTerm: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM events
    WHERE deleted_at IS NULL
      AND to_tsvector('simple', title || ' ' || coalesce(description, ''))
          @@ plainto_tsquery('simple', ${searchTerm})
    ORDER BY ts_rank(
      to_tsvector('simple', title || ' ' || coalesce(description, '')),
      plainto_tsquery('simple', ${searchTerm})
    ) DESC
    LIMIT 200
  `;
  return rows.map((r) => r.id);
}

export const eventRepository = {
  async findMany(query: ListEventQuery) {
    // Nếu có search term: TÌM ID TRƯỚC bằng Full-Text Search (đã sắp
    // theo độ liên quan), rồi mới lọc theo categoryId/status qua
    // Prisma bình thường trên đúng tập ID đó. Cách 2 bước này giữ được
    // nguyên vẹn "include" (category, venue, organizer) đã có sẵn, mà
    // không phải viết lại toàn bộ câu JOIN bằng raw SQL.
    let searchedIds: string[] | null = null;
    if (query.search) {
      searchedIds = await searchEventIds(query.search);
      // Không tìm thấy gì khớp -> trả về rỗng NGAY, tránh query DB
      // thêm 1 lần vô ích (where id IN [] luôn trả rỗng nhưng vẫn tốn
      // 1 round-trip nếu không chặn sớm).
      if (searchedIds.length === 0) {
        return { items: [], total: 0 };
      }
    }

    const where: Prisma.EventWhereInput = {
      deletedAt: null,
      ...(query.categoryId && { categoryId: query.categoryId }),
      ...(query.organizerId && { organizerId: query.organizerId }),
      status: query.status ?? 'PUBLISHED',
      ...(searchedIds && { id: { in: searchedIds } }),
    };

    // Khi có search: PHẢI giữ đúng thứ tự "độ liên quan nhất trước" từ
    // searchedIds (ts_rank), KHÔNG dùng orderBy startTime như bình
    // thường - nếu không, kết quả khớp nhất có thể bị trôi xuống cuối
    // trang chỉ vì diễn ra muộn hơn.
    const orderBy: Prisma.EventOrderByWithRelationInput = query.search
      ? {} // giữ nguyên thứ tự truy vấn theo mảng "in" bên dưới (xử lý thủ công)
      : { startTime: 'asc' };

    // Xây tham số truy vấn CÓ ĐIỀU KIỆN (spread) thay vì gán field rồi
    // để "undefined" tường minh - "exactOptionalPropertyTypes: true"
    // (Phase 3) không chấp nhận field tồn tại nhưng mang giá trị
    // undefined, chỉ chấp nhận "có field với giá trị thật" hoặc
    // "hoàn toàn không có field đó" (đây là pattern đã lặp lại nhiều
    // lần từ Phase 4 - JWT options - tới giờ, đáng nhớ vì sẽ còn gặp).
    const findManyArgs: Prisma.EventFindManyArgs = {
      where,
      include: {
        category: { select: { id: true, name: true } },
        venue: { select: { id: true, name: true, city: true } },
        organizer: { select: { id: true, fullName: true } },
      },
    };
    if (query.search) {
      findManyArgs.skip = 0; // search: phân trang thủ công sau khi sắp lại đúng thứ tự relevance
    } else {
      findManyArgs.skip = (query.page - 1) * query.limit;
      findManyArgs.take = query.limit;
      findManyArgs.orderBy = orderBy;
    }

    const [rawItems, total] = await Promise.all([
      prisma.event.findMany(findManyArgs),
      prisma.event.count({ where }),
    ]);

    // Prisma "where id IN [...]" KHÔNG giữ đúng thứ tự mảng đầu vào -
    // phải tự sắp lại theo đúng thứ tự searchedIds (đã có sẵn ts_rank)
    // rồi mới cắt trang thủ công.
    let items = rawItems;
    if (query.search && searchedIds) {
      const orderMap = new Map(searchedIds.map((id, idx) => [id, idx]));
      items = [...rawItems].sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
      const start = (query.page - 1) * query.limit;
      items = items.slice(start, start + query.limit);
    }

    return { items, total };
  },

  findById(id: string) {
    return prisma.event.findFirst({
      where: { id, deletedAt: null },
      include: {
        category: true,
        venue: true,
        organizer: { select: { id: true, fullName: true, email: true } },
        ticketTypes: true,
      },
    });
  },

  create(data: CreateEventInput & { organizerId: string }) {
    return prisma.event.create({
      data: data as unknown as Prisma.EventUncheckedCreateInput,
      include: { category: true, venue: true },
    });
  },

  update(id: string, data: UpdateEventInput) {
    return prisma.event.update({
      where: { id },
      data: data as Prisma.EventUpdateInput,
    });
  },

  updateCoverImage(id: string, coverImage: string) {
    return prisma.event.update({
      where: { id },
      data: { coverImage },
    });
  },

  // Soft delete - không xóa thật khỏi DB, chỉ đánh dấu deletedAt.
  // Lý do: Event đã bán vé thì KHÔNG được xóa cứng (mất luôn lịch sử
  // đơn hàng, vé đã phát hành) - đây là nguyên tắc chung cho mọi bảng
  // có liên quan tới giao dịch tài chính.
  softDelete(id: string) {
    return prisma.event.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  },
};