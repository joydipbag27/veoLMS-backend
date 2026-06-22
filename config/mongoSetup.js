import mongoose from "mongoose";
import { ConnectDB } from "./db.js";

await ConnectDB();
const client = mongoose.connection.getClient();

try {
  const db = mongoose.connection.db;

  await db.command({
    collMod: "users",
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "_id",
          "username",
          "email",
          "rootDirId",
          "isBlocked",
          "planId",
          "__v",
        ],
        properties: {
          _id: {
            bsonType: "objectId",
          },
          username: {
            bsonType: "string",
            minLength: 3,
            maxLength: 100,
          },
          email: {
            bsonType: "string",
            pattern: "^[\\w.-]+@[a-zA-Z\\d.-]+\\.[a-zA-Z]{2,}$",
          },
          password: {
            bsonType: "string",
            minLength: 4,
          },
          rootDirId: {
            bsonType: "objectId",
          },
          __v: {
            bsonType: "int",
          },
          isBlocked: {
            bsonType: "bool",
          },
          role: {
            bsonType: "string",
            enum: ["Owner", "Admin", "Manager", "User"],
          },
          bandwidthUsedBytes: {
            bsonType: ["long", "int", "double"],
          },
          bandwidthCycleStart: {
            bsonType: ["date", "null"],
          },
          planId: {
            bsonType: "string",
          },
        },
        additionalProperties: false,
      },
    },
    validationAction: "error",
    validationLevel: "strict",
  });

  await db.command({
    collMod: "directories",
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "_id",
          "name",
          "parentDirId",
          "userId",
          "createdAt",
          "updatedAt",
          "directorySize",
          "fileCount",
          "folderCount",
          "__v",
        ],
        properties: {
          _id: {
            bsonType: "objectId",
          },
          name: {
            bsonType: "string",
            minLength: 1,
            maxLength: 100,
          },
          parentDirId: {
            bsonType: ["objectId", "null"],
          },
          userId: {
            bsonType: "objectId",
          },
          createdAt: {
            bsonType: "date",
          },
          updatedAt: {
            bsonType: "date",
          },
          directorySize: {
            bsonType: ["int", "double", "long"],
            minimum: 0,
          },
          path: {
            bsonType: "array",
            items: {
              bsonType: "objectId",
            },
          },
          fileCount: {
            bsonType: ["int", "double", "long"],
          },
          folderCount: {
            bsonType: ["int", "double", "long"],
          },
          __v: {
            bsonType: "int",
          },
        },
        additionalProperties: false,
      },
    },
    validationAction: "error",
    validationLevel: "strict",
  });

  await db.command({
    collMod: "files",
    validator: {
      $jsonSchema: {
        required: [
          "_id",
          "extension",
          "name",
          "userId",
          "parentDirId",
          "fileSize",
          "isUploading",
          "createdAt",
          "updatedAt",
          "fileType",
          "__v",
        ],
        properties: {
          _id: {
            bsonType: "objectId",
          },
          extension: {
            bsonType: "string",
            minLength: 2,
            maxLength: 100,
          },
          name: {
            bsonType: "string",
            minLength: 1,
            maxLength: 100,
          },
          userId: {
            bsonType: "objectId",
          },
          parentDirId: {
            bsonType: "objectId",
          },
          fileSize: {
            bsonType: "int",
          },
          isUploading: {
            bsonType: "bool",
          },
          createdAt: {
            bsonType: "date",
          },
          updatedAt: {
            bsonType: "date",
          },
          favorite: {
            bsonType: "bool",
          },
          isTrashed: {
            bsonType: "bool",
          },
          trashedAt: {
            bsonType: ["date", "null"],
          },
          deletedAt: {
            bsonType: ["date", "null"],
          },
          mimeType: {
            bsonType: "string",
          },
          fileType: {
            bsonType: "string",
          },
          thumbnailStatus: {
            enum: ["pending", "done"],
          },
          thumbnailUrl: {
            bsonType: "string",
          },
          lastAccessedAt: {
            bsonType: "date"
          },
          __v: {
            bsonType: "int",
          },
        },
        additionalProperties: false,
      },
    },
    validationAction: "error",
    validationLevel: "strict",
  });

  await db.command({
    collMod: "subscriptions",
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "razorpaySubscriptionId",
          "userId",
          "planId",
          "planKey",
          "billingCycle",
          "status",
        ],
        properties: {
          razorpaySubscriptionId: { bsonType: "string" },
          userId: { bsonType: "objectId" },
          planId: { bsonType: "string" },
          planKey: { bsonType: "string" },
          billingCycle: { enum: ["monthly", "yearly"] },
          status: {
            enum: [
              "created",
              "active",
              "in_grace",
              "cancelled",
              "expired",
              "upgrading",
            ],
          },
          currentPeriodStart: { bsonType: ["date", "null"] },
          currentPeriodEnd: { bsonType: ["date", "null"] },
          cancelledAt: { bsonType: ["date", "null"] },
          cancelAtPeriodEnd: { bsonType: "bool" },
          gracePeriodEndsAt: { bsonType: ["date", "null"] },
          createdExpiresAt: { bsonType: ["date", "null"] },
          expiredAt: { bsonType: ["date", "null"] },
          deletionWarningSent: { bsonType: "bool" },
          deletionScheduledAt: { bsonType: ["date", "null"] },
          filesDeleted: { bsonType: "bool" },
          filesDeletedAt: { bsonType: ["date", "null"] },
        },
      },
    },
  });

  await db.command({
    collMod: "shares",
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["ownerId", "fileId", "token", "sharedWith", "fileType"],
        properties: {
          ownerId: { bsonType: "objectId" },
          fileId: { bsonType: "objectId" },
          token: { bsonType: "string" },
          sharedWith: { bsonType: "array", items: { bsonType: "string" } },
          expiresAt: { bsonType: ["date", "null"] },
          totalViews: { bsonType: "int" },
          totalDownloads: { bsonType: "int" },
          lastAccessedAt: { bsonType: ["date", "null"] },
          maxDownloads: { bsonType: ["int", "null"] },
          fileType: {
            bsonType: "string",
          },
        },
      },
    },
  });

  await db.command({
    collMod: "otps",
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["email", "createdAt", "expiresAt", "purpose"],
        properties: {
          email: { bsonType: "string" },
          otp: { bsonType: "string" },
          createdAt: { bsonType: "date" },
          expiresAt: { bsonType: "date" },
          purpose: { enum: ["auth", "security"] },
          newEmail: { bsonType: "string" },
          newEmailOtp: { bsonType: "string" },
        },
      },
    },
  });

  await db.command({
    collMod: "notifications",
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["userId", "type", "title", "message"],
        properties: {
          userId: { bsonType: "objectId" },
          type: { bsonType: "string" },
          title: { bsonType: "string" },
          message: { bsonType: "string" },
          metadata: {
            bsonType: "object",
            properties: {
              fileId: { bsonType: "objectId" },
              folderId: { bsonType: "objectId" },
              sharedBy: { bsonType: "objectId" },
              token: { bsonType: "string" },
            },
          },
          count: { bsonType: "int" },
          isRead: { bsonType: "bool" },
        },
      },
    },
  });

  // Indexes for users
  await db.collection("users").createIndex({ email: 1 }, { unique: true });
  await db.collection("users").createIndex({ username: 1 });

  // Indexes for directories
  await db.collection("directories").createIndex({ userId: 1 });
  await db.collection("directories").createIndex({ parentDirId: 1 });
  await db.collection("directories").createIndex({ path: 1 });

  // Indexes for files
  await db.collection("files").createIndex({ isTrashed: 1, deletedAt: 1 });
  await db.collection("files").createIndex({ userId: 1, favorite: 1 });
  await db.collection("files").createIndex({ parentDirId: 1 });
  await db.collection("files").createIndex({ parentDirId: 1, name: 1 });

  // Indexes for subscriptions
  await db
    .collection("subscriptions")
    .createIndex({ expiredAt: 1 }, { expireAfterSeconds: 604800 });
  await db.collection("subscriptions").createIndex({ userId: 1 });
  await db.collection("subscriptions").createIndex(
    { userId: 1 },
    {
      unique: true,
      partialFilterExpression: { status: { $in: ["active", "in_grace"] } },
    },
  );

  // Indexes for shares
  await db.collection("shares").createIndex({ token: 1 }, { unique: true });
  await db
    .collection("shares")
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection("shares").createIndex({ ownerId: 1 });
  await db.collection("shares").createIndex({ fileId: 1 });

  // Indexes for otps
  await db.collection("otps").createIndex({ email: 1 }, { unique: true });
  await db
    .collection("otps")
    .createIndex({ email: 1, purpose: 1 }, { unique: true });
  await db
    .collection("otps")
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  // Indexes for notifications
  await db.collection("notifications").createIndex({ userId: 1 });
  await db.collection("notifications").createIndex({ isRead: 1 });
  await db.collection("notifications").createIndex({ userId: 1, isRead: 1 });

  console.log("Databse schema and index setup is completed");
} catch (error) {
  console.log("Error setting up the database", error);
} finally {
  await client.close();
}
