import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanupDuplicates() {
  console.log('🔍 Checking for duplicate task completions...\n');

  const allCompletions = await prisma.taskCompletion.findMany({
    orderBy: [
      { userId: 'asc' },
      { taskId: 'asc' },
      { completedAt: 'asc' },
      { timestamp: 'asc' }
    ]
  });

  console.log(`Total completions: ${allCompletions.length}`);

  const seen = new Map<string, string>();
  const toDelete: string[] = [];

  for (const comp of allCompletions) {
    const dateStr = comp.completedAt.toISOString().split('T')[0];
    const key = `${comp.userId}-${comp.taskId}-${dateStr}`;

    if (seen.has(key)) {
      toDelete.push(comp.id);
      console.log(`❌ Duplicate: User ${comp.userId}, Task ${comp.taskId}, Date ${dateStr}`);
    } else {
      seen.set(key, comp.id);
    }
  }

  console.log(`\n📊 Found ${toDelete.length} duplicates to delete`);

  if (toDelete.length > 0) {
    const result = await prisma.taskCompletion.deleteMany({
      where: { id: { in: toDelete } }
    });
    console.log(`✅ Deleted ${result.count} duplicate completions`);
  } else {
    console.log(`✅ No duplicates found!`);
  }

  console.log(`\n✨ Cleanup complete! Unique completions: ${seen.size}`);
}

cleanupDuplicates()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
