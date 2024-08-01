import { NextResponse } from 'next/server';
import prisma from '@/utils/prisma';
import { validateTelegramWebAppData } from '@/utils/server-checks';
import { TASK_WAIT_TIME } from '@/utils/consts';

interface CheckVisitTaskRequestBody {
    initData: string;
    taskId: string;
}

export async function POST(req: Request) {
    const requestBody: CheckVisitTaskRequestBody = await req.json();
    const { initData: telegramInitData, taskId } = requestBody;

    if (!telegramInitData || !taskId) {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const { validatedData, user } = validateTelegramWebAppData(telegramInitData);

    if (!validatedData) {
        return NextResponse.json({ error: 'Invalid Telegram data' }, { status: 403 });
    }

    const telegramId = user.id?.toString();

    if (!telegramId) {
        return NextResponse.json({ error: 'Invalid user data' }, { status: 400 });
    }

    try {
        const result = await prisma.$transaction(async (prisma) => {
            // Find the user
            const dbUser = await prisma.user.findUnique({
                where: { telegramId },
            });

            if (!dbUser) {
                throw new Error('User not found');
            }

            // Find the task
            const task = await prisma.task.findUnique({
                where: { id: taskId },
            });

            if (!task) {
                throw new Error('Task not found');
            }

            // Check if the task is of type VISIT
            if (task.type !== 'VISIT') {
                throw new Error('Invalid task type for this operation');
            }

            // Find the user's task
            const userTask = await prisma.userTask.findUnique({
                where: {
                    userId_taskId: {
                        userId: dbUser.id,
                        taskId: task.id,
                    },
                },
            });

            if (!userTask) {
                throw new Error('Task not started');
            }

            if (userTask.isCompleted) {
                throw new Error('Task already completed');
            }

            // Check if one hour has passed
            const oneHourAgo = new Date(Date.now() - TASK_WAIT_TIME);
            if (userTask.taskStartTimestamp > oneHourAgo) {
                throw new Error('Not enough time has passed');
            }

            // Update the task as completed
            const updatedUserTask = await prisma.userTask.update({
                where: {
                    id: userTask.id,
                },
                data: {
                    isCompleted: true,
                },
            });

            // Add points to user's balance
            await prisma.user.update({
                where: { id: dbUser.id },
                data: {
                    points: { increment: task.points },
                    pointsBalance: { increment: task.points },
                },
            });

            return updatedUserTask;
        });

        return NextResponse.json({
            success: true,
            message: 'Task completed successfully',
            isCompleted: result.isCompleted,
        });

    } catch (error) {
        console.error('Error checking visit task:', error);
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to check visit task' }, { status: 500 });
    }
}