// FILE PATH: prisma/seed.ts
//
// FIXES IN THIS VERSION:
//
// 1. REMOVED YouTube videoUrl values from all seeded modules.
//
//    Root cause of previous bug:
//    - Seeded modules had videoUrl set to YouTube links (e.g.
//      "https://www.youtube.com/watch?v=…") with videoKey = null.
//    - VideoPlayer.tsx correctly shows "Video Not Available" for non-stream
//      URLs and never fires the heartbeat system, so VideoProgress.completed
//      is never set to true for those modules.
//    - Both the quiz page (app/quiz/[id]/page.tsx) and the quiz attempt API
//      (app/api/quiz/[id]/attempt/route.ts) were gating on quiz.module.videoUrl
//      being truthy → YouTube URL is truthy → gate fires → students permanently
//      blocked from quizzes on all three seeded courses.
//
//    Fix: Set videoUrl = null on all seeded modules. Instructors (or admins)
//    must upload real MP4 files via the VideoUpload component. Only then is
//    the heartbeat system activated and the quiz gate becomes meaningful.
//    The quiz gate was separately fixed to check videoKey instead of videoUrl.
//
// 2. APPROVAL STATUS guaranteed on every re-seed run.
//    Both create AND update blocks set approvalStatus: "APPROVED", approvedAt,
//    and isPublished: true so that re-running `npm run setup` always restores
//    the seeded courses to a visible, enrollable state — even if an admin
//    previously rejected or unpublished them.
//
// 3. Introduction to Programming course always gets instructorId: instructor.id
//    so it shows a real instructor name in the UI.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding NovaMind LMS v11...");

  // Admin user — password is hashed; change via reset-password flow or re-seed
  const adminPassword = process.env.ADMIN_SEED_PASSWORD || "ChangeMe!2025";
  const adminHash = await bcrypt.hash(adminPassword, 12);

  // Enforce single admin: upsert updates password hash on re-seed
  await prisma.user.upsert({
    where: { email: "admin@novamind.lms" },
    update: { hashedPassword: adminHash },
    create: {
      email: "admin@novamind.lms",
      name: "Admin",
      role: "ADMIN",
      hashedPassword: adminHash,
    },
  });

  // Instructor 1
  const pw = await bcrypt.hash("instructor123", 12);
  const instructor = await prisma.instructor.upsert({
    where: { email: "alex@novamind.lms" },
    update: {},
    create: {
      name: "Alex Chen",
      email: "alex@novamind.lms",
      hashedPassword: pw,
      bio: "Senior software engineer with 10 years of experience in full-stack development.",
      specialization: "Full-Stack Development",
    },
  });

  // Instructor 2
  const instructor2 = await prisma.instructor.upsert({
    where: { email: "sarah@novamind.lms" },
    update: {},
    create: {
      name: "Sarah Kim",
      email: "sarah@novamind.lms",
      hashedPassword: pw,
      bio: "Data scientist specializing in machine learning and AI.",
      specialization: "Data Science & AI",
    },
  });

  // ── Course 1: Full-Stack Web Development ──────────────────────────────────
  // Both create AND update blocks set approvalStatus + isPublished so that
  // re-running `npm run setup` always restores courses to visible state.
  const web = await prisma.course.upsert({
    where: { slug: "fullstack-web-development" },
    update: {
      approvalStatus: "APPROVED",
      approvedAt: new Date(),
      isPublished: true,
      // Clear any rejection data from previous admin actions
      rejectedAt: null,
      reviewComment: null,
    },
    create: {
      slug: "fullstack-web-development",
      title: "Full-Stack Web Development",
      description:
        "Master modern web development from React and Next.js to Node.js, databases, and deployment. Build production-ready applications with confidence.",
      category: "Programming",
      level: "Intermediate",
      price: 2999,
      isPublished: true,
      isFeatured: true,
      durationMins: 225, // 60+90+75
      instructorId: instructor.id,
      approvalStatus: "APPROVED",
      approvedAt: new Date(),
    },
  });

  // FIX: videoUrl is null on all seeded modules.
  // Instructors must upload real MP4 files via the VideoUpload component.
  // The quiz gate (videoKey check) will be inactive until a real video is
  // uploaded, so students can attempt quizzes immediately on fresh installs.
  const webModules = [
    {
      title: "Introduction to React",
      description: "Learn React fundamentals: components, props, state, and hooks.",
      durationMins: 60,
      order: 1,
      isFree: true,
      quiz: {
        title: "React Fundamentals Quiz",
        description: "Test your understanding of React basics",
        questions: [
          {
            question: "What is JSX in React?",
            options: [
              "A JavaScript library",
              "A syntax extension for JavaScript that looks like HTML",
              "A CSS framework",
              "A database query language",
            ],
            correctAnswer: 1,
            explanation:
              "JSX is a syntax extension for JavaScript that allows you to write HTML-like code in your JavaScript files.",
          },
          {
            question: "Which hook is used to manage state in a functional component?",
            options: ["useEffect", "useContext", "useState", "useRef"],
            correctAnswer: 2,
            explanation:
              "useState is the primary hook for adding state to functional components.",
          },
          {
            question: "What does the useEffect hook do?",
            options: [
              "Manages component state",
              "Handles side effects like data fetching",
              "Creates context",
              "Formats JSX",
            ],
            correctAnswer: 1,
            explanation:
              "useEffect lets you perform side effects in function components.",
          },
          {
            question: "How do you pass data from parent to child in React?",
            options: ["State", "Props", "Context", "Redux"],
            correctAnswer: 1,
            explanation:
              "Props are used to pass data from parent to child components.",
          },
        ],
      },
    },
    {
      title: "Next.js & App Router",
      description:
        "Deep dive into Next.js 14 with the App Router, Server Components, and data fetching.",
      durationMins: 90,
      order: 2,
      isFree: false,
      quiz: {
        title: "Next.js App Router Quiz",
        description: "Test your Next.js knowledge",
        questions: [
          {
            question: "What is a Server Component in Next.js?",
            options: [
              "A component that only runs in the browser",
              "A component that renders on the server with no client-side JS",
              "A component for handling API routes",
              "A component for styling",
            ],
            correctAnswer: 1,
            explanation:
              "Server Components render on the server and send HTML to the client without shipping JavaScript.",
          },
          {
            question: "Which folder structure does the Next.js App Router use?",
            options: ["pages/", "src/app/", "routes/", "views/"],
            correctAnswer: 1,
            explanation:
              "The App Router uses the app/ directory where each folder represents a route segment.",
          },
          {
            question: "What does generateStaticParams do?",
            options: [
              "Creates API routes",
              "Pre-renders dynamic routes at build time",
              "Manages state",
              "Handles authentication",
            ],
            correctAnswer: 1,
            explanation:
              "generateStaticParams generates static pages for dynamic routes at build time.",
          },
        ],
      },
    },
    {
      title: "Databases & Prisma ORM",
      description:
        "Learn to work with databases using Prisma ORM, schema design, and migrations.",
      durationMins: 75,
      order: 3,
      isFree: false,
      quiz: {
        title: "Prisma & Databases Quiz",
        description: "",
        questions: [
          {
            question: "What is Prisma?",
            options: [
              "A CSS framework",
              "A type-safe database ORM for Node.js",
              "A state management library",
              "A testing framework",
            ],
            correctAnswer: 1,
            explanation:
              "Prisma is a next-generation ORM that makes database access easy and type-safe.",
          },
          {
            question: "What file defines your Prisma data model?",
            options: [
              "prisma.config.ts",
              "schema.prisma",
              "models.ts",
              "database.json",
            ],
            correctAnswer: 1,
            explanation:
              "The schema.prisma file contains your data model definition.",
          },
          {
            question: "Which command pushes Prisma schema changes to the database?",
            options: [
              "prisma migrate",
              "prisma db push",
              "prisma sync",
              "prisma update",
            ],
            correctAnswer: 1,
            explanation:
              "prisma db push pushes the state of your Prisma schema to the database.",
          },
        ],
      },
    },
  ];

  for (const modData of webModules) {
    const existing = await prisma.module.findFirst({
      where: { courseId: web.id, order: modData.order },
    });
    let mod = existing;
    if (!mod) {
      mod = await prisma.module.create({
        data: {
          courseId: web.id,
          title: modData.title,
          description: modData.description,
          // FIX: videoUrl is null — instructor must upload a real MP4.
          // Previously this was a YouTube URL which broke quiz unlock for all students.
          videoUrl: null,
          videoKey: null,
          durationMins: modData.durationMins,
          order: modData.order,
          isFree: modData.isFree,
          isPublished: true,
        },
      });
    } else {
      // FIX: On re-seed, clear any lingering YouTube videoUrl values from older
      // seed runs. Only clear if videoKey is null (no real upload exists).
      if (!mod.videoKey && mod.videoUrl && mod.videoUrl.includes("youtube")) {
        await prisma.module.update({
          where: { id: mod.id },
          data: { videoUrl: null },
        });
      }
    }

    const existingQuiz = await prisma.quiz.findFirst({
      where: { moduleId: mod.id },
    });
    if (!existingQuiz && modData.quiz) {
      const quiz = await prisma.quiz.create({
        data: {
          moduleId: mod.id,
          title: modData.quiz.title,
          description: modData.quiz.description || "",
        },
      });
      for (let i = 0; i < modData.quiz.questions.length; i++) {
        const q = modData.quiz.questions[i];
        await prisma.quizQuestion.create({
          data: {
            quizId: quiz.id,
            question: q.question,
            options: JSON.stringify(q.options),
            correctAnswer: q.correctAnswer,
            explanation: q.explanation || "",
            order: i,
          },
        });
      }
    }
  }

  // ── Course 2: Python & Machine Learning ───────────────────────────────────
  const ml = await prisma.course.upsert({
    where: { slug: "python-machine-learning" },
    update: {
      approvalStatus: "APPROVED",
      approvedAt: new Date(),
      isPublished: true,
      rejectedAt: null,
      reviewComment: null,
    },
    create: {
      slug: "python-machine-learning",
      title: "Python & Machine Learning",
      description:
        "From Python basics to building ML models with scikit-learn, pandas, and TensorFlow. Perfect for aspiring data scientists.",
      category: "AI/ML",
      level: "Beginner",
      price: 3499,
      isPublished: true,
      isFeatured: true,
      durationMins: 210, // 90+120
      instructorId: instructor2.id,
      approvalStatus: "APPROVED",
      approvedAt: new Date(),
    },
  });

  const mlMods = [
    {
      title: "Python Fundamentals",
      description:
        "Variables, data types, control flow, functions, and OOP in Python.",
      durationMins: 90,
      order: 1,
      isFree: true,
      quiz: {
        title: "Python Basics Quiz",
        questions: [
          {
            question: "What is the output of type(3.14)?",
            options: [
              "<class 'int'>",
              "<class 'float'>",
              "<class 'double'>",
              "<class 'number'>",
            ],
            correctAnswer: 1,
            explanation:
              "3.14 is a floating-point number, so type() returns float.",
          },
          {
            question: "Which keyword is used to define a function in Python?",
            options: ["function", "def", "func", "define"],
            correctAnswer: 1,
            explanation:
              "In Python, functions are defined using the 'def' keyword.",
          },
          {
            question: "What does list comprehension do?",
            options: [
              "Deletes list items",
              "Creates a new list based on an existing iterable",
              "Sorts a list",
              "Reverses a list",
            ],
            correctAnswer: 1,
            explanation:
              "List comprehension provides a concise way to create lists.",
          },
        ],
      },
    },
    {
      title: "Data Analysis with Pandas",
      description: "Load, clean, and analyze data using Pandas DataFrames.",
      durationMins: 120,
      order: 2,
      isFree: false,
      quiz: {
        title: "Pandas Quiz",
        questions: [
          {
            question: "What is a Pandas DataFrame?",
            options: [
              "A 1D array",
              "A 2D labeled data structure with columns",
              "A dictionary",
              "A NumPy matrix",
            ],
            correctAnswer: 1,
            explanation:
              "A DataFrame is a 2-dimensional labeled data structure with columns of potentially different types.",
          },
          {
            question: "Which method reads a CSV file in Pandas?",
            options: [
              "pd.load_csv()",
              "pd.read_csv()",
              "pd.open_csv()",
              "pd.csv()",
            ],
            correctAnswer: 1,
            explanation:
              "pd.read_csv() is the standard method to read CSV files into a DataFrame.",
          },
          {
            question:
              "How do you select a column named 'age' from DataFrame df?",
            options: [
              "df.column('age')",
              "df['age']",
              "df.select('age')",
              "df.get('age')",
            ],
            correctAnswer: 1,
            explanation:
              "Columns in a DataFrame are accessed using bracket notation: df['column_name'].",
          },
        ],
      },
    },
  ];

  for (const modData of mlMods) {
    const existing = await prisma.module.findFirst({
      where: { courseId: ml.id, order: modData.order },
    });
    let mod = existing;
    if (!mod) {
      mod = await prisma.module.create({
        data: {
          courseId: ml.id,
          title: modData.title,
          description: modData.description,
          // FIX: videoUrl is null on all seeded modules.
          videoUrl: null,
          videoKey: null,
          durationMins: modData.durationMins,
          order: modData.order,
          isFree: modData.isFree,
          isPublished: true,
        },
      });
    } else if (existing) {
      // Clear lingering YouTube URLs from older seed runs
      if (!existing.videoKey && existing.videoUrl && existing.videoUrl.includes("youtube")) {
        await prisma.module.update({
          where: { id: existing.id },
          data: { videoUrl: null },
        });
      }
    }

    const existingQuiz = await prisma.quiz.findFirst({
      where: { moduleId: mod.id },
    });
    if (!existingQuiz) {
      const quiz = await prisma.quiz.create({
        data: { moduleId: mod.id, title: modData.quiz.title },
      });
      for (let i = 0; i < modData.quiz.questions.length; i++) {
        const q = modData.quiz.questions[i];
        await prisma.quizQuestion.create({
          data: {
            quizId: quiz.id,
            question: q.question,
            options: JSON.stringify(q.options),
            correctAnswer: q.correctAnswer,
            explanation: q.explanation || "",
            order: i,
          },
        });
      }
    }
  }

  // ── Course 3: Introduction to Programming (free) ──────────────────────────
  const intro = await prisma.course.upsert({
    where: { slug: "intro-to-programming" },
    update: {
      approvalStatus: "APPROVED",
      approvedAt: new Date(),
      isPublished: true,
      instructorId: instructor.id,
      rejectedAt: null,
      reviewComment: null,
    },
    create: {
      slug: "intro-to-programming",
      title: "Introduction to Programming",
      description:
        "Start your coding journey! Learn the fundamental concepts of programming with hands-on examples.",
      category: "Programming",
      level: "Beginner",
      price: 0,
      isPublished: true,
      durationMins: 45,
      instructorId: instructor.id,
      approvalStatus: "APPROVED",
      approvedAt: new Date(),
    },
  });

  // Add a starter module to the free course so enrolled students see content
  const introModExisting = await prisma.module.findFirst({
    where: { courseId: intro.id, order: 1 },
  });
  if (!introModExisting) {
    await prisma.module.create({
      data: {
        courseId: intro.id,
        title: "What is Programming?",
        description:
          "Understand what programming is, why it matters, and how to think like a developer.",
        // FIX: videoUrl is null — instructor must upload a real MP4.
        videoUrl: null,
        videoKey: null,
        durationMins: 45,
        order: 1,
        isFree: true,
        isPublished: true,
      },
    });
  } else {
    // Clear lingering YouTube URLs from older seed runs
    if (!introModExisting.videoKey && introModExisting.videoUrl && introModExisting.videoUrl.includes("youtube")) {
      await prisma.module.update({
        where: { id: introModExisting.id },
        data: { videoUrl: null },
      });
    }
  }

  console.log("✅ Seed complete!");
  console.log(`   Admin:        admin@novamind.lms / ${adminPassword}`);
  console.log("   Instructor 1: alex@novamind.lms  / instructor123");
  console.log("   Instructor 2: sarah@novamind.lms / instructor123");
  console.log("");
  console.log("   📹 Video upload note:");
  console.log("      All seeded modules have no video (videoUrl=null, videoKey=null).");
  console.log("      Instructors must upload real MP4 files via the VideoUpload component.");
  console.log("      Quizzes are immediately accessible on fresh installs (no video gate).");
  console.log("      The video gate only activates once an instructor uploads an MP4.");
  console.log("");
  console.log("   ⚠️  Set ADMIN_SEED_PASSWORD env var before seeding in production!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());