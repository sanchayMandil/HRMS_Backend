# HRMS Attendance Backend

Backend scaffold for the MERN attendance management assessment.

## Included setup

- Express server bootstrap
- MongoDB connection layer with Mongoose
- JWT-ready environment variables
- Logging with Morgan and Winston
- Cloudinary configuration for selfie/image storage
- Clean feature-based folder structure

## Folder structure

```text
src/
  config/
  database/
  middlewares/
  modules/
    attendance/
    auth/
    dashboard/
    overtime/
    reports/
    users/
  routes/
  shared/
    constants/
    logger/
    utils/
  app.js
  server.js
```

## Scripts

- `npm run dev` starts the backend with nodemon
- `npm start` starts the backend with Node

## Notes

- Feature code is intentionally not implemented yet.
- The structure is ready for controllers, services, validators, and routes per module.
