const dns = require("dns");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
require("dotenv").config();

dns.setServers(["8.8.8.8", "8.8.4.4"]);

const ROLES = require("../src/shared/constants/roles");

const userSchema = new mongoose.Schema(
  {
    name: String,
    email: { type: String, unique: true, lowercase: true },
    password: { type: String, select: false },
    role: { type: String, enum: Object.values(ROLES) },
    department: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const User = mongoose.models.User || mongoose.model("User", userSchema);

const ADMIN = {
  name: "Super Admin",
  email: "admin@hrms.com",
  password: "Admin@1234",
  role: ROLES.ADMIN,
  department: "Management",
};

const seed = async () => {
  await mongoose.connect(process.env.MONGODB_URI, { family: 4 });
  console.log("MongoDB connected");

  const existing = await User.findOne({ email: ADMIN.email });
  if (existing) {
    console.log(`Admin already exists: ${ADMIN.email}`);
    process.exit(0);
  }

  const hashed = await bcrypt.hash(ADMIN.password, 12);
  await User.create({ ...ADMIN, password: hashed });

  console.log("Admin seeded successfully");
  console.log(`  Email   : ${ADMIN.email}`);
  console.log(`  Password: ${ADMIN.password}`);
  console.log("Change the password after first login!");

  process.exit(0);
};

seed().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
