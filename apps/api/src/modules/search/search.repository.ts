import { prisma } from "../../config/database";
import type { Prisma } from "@prisma/client";

function buildWhere(patterns: string[]): Prisma.BusinessWhereInput {
  // A wide net: any business mentioning any fragment of any term (see
  // shared/utils/textMatch.ts). search.service.ts then scores each one against the terms
  // themselves and keeps only the relevant ones, so recall here costs no precision there.
  return {
    OR: patterns.map((word) => ({
      OR: [
        { name: { contains: word, mode: "insensitive" } },
        { description: { contains: word, mode: "insensitive" } },
        { category: { contains: word, mode: "insensitive" } },
        // Where the business is: searching "Cacuaco" finds the businesses there.
        { address: { contains: word, mode: "insensitive" } },
        { bairro: { contains: word, mode: "insensitive" } },
        { municipio: { contains: word, mode: "insensitive" } },
        { provincia: { contains: word, mode: "insensitive" } },
        {
          services: {
            some: {
              active: true,
              OR: [
                { name: { contains: word, mode: "insensitive" } },
                { description: { contains: word, mode: "insensitive" } },
                { category: { contains: word, mode: "insensitive" } },
              ],
            },
          },
        },
      ],
    })),
  };
}

export const searchRepository = {
  findCandidates(patterns: string[]) {
    return prisma.business.findMany({
      where: buildWhere(patterns),
      include: {
        reviews: { select: { rating: true } },
        _count: { select: { favorites: true } },
        services: { where: { active: true } },
      },
    });
  },
};
