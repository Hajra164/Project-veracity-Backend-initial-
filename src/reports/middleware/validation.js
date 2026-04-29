const { param, validationResult } = require('express-validator');

// Validates :projectId is a valid integer (your project_id is INT in Neon)
const validateProjectId = [
  param('projectId')
    .notEmpty().withMessage('Project ID is required.')
    .isInt({ min: 1 }).withMessage('Project ID must be a positive integer.'),

  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error : 'Invalid request parameters.',
        details: errors.array().map(e => e.msg),
      });
    }
    next();
  },
];

module.exports = { validateProjectId };