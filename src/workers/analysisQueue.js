const axios = require('axios');
const pool = require('../db');
const FormData = require('form-data');
const fs = require('fs');
const { calibrateRisk } = require('../reports/utils/calibration');
require('dotenv').config();

const analyzeProject = async (projectId, fileBuffer, filename, userId) => {
  try {
    console.log(`🔄 Starting analysis for project ${projectId}...`);

    // ✅ Validate buffer before sending
    if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
      throw new Error(`Invalid fileBuffer for project ${projectId}: expected a Buffer, got ${typeof fileBuffer}`);
    }

    if (fileBuffer.length === 0) {
      throw new Error(`Empty file buffer for project ${projectId}`);
    }

    const safeFilename = (filename && filename.endsWith('.py'))
      ? filename
      : 'code.py';  // ✅ FastAPI rejects non-.py filenames with 400

    console.log(`📦 Sending ${fileBuffer.length} bytes as '${safeFilename}' to ML worker`);

    const form = new FormData();
    form.append('file', fileBuffer, {
      filename: safeFilename,
      contentType: 'text/x-python'
    });

    let response;
    try {
      response = await axios.post(
        `${process.env.ML_WORKER_URL}/analyze-file`,
        form,
        {
          headers: form.getHeaders(),
          timeout: 60000,
          maxContentLength: 5 * 1024 * 1024,  // ✅ Match ML worker's 5MB limit
          maxBodyLength: 5 * 1024 * 1024
        }
      );
    } catch (axiosErr) {
      // ✅ Surface the actual ML error message, not just "400"
      if (axiosErr.response) {
        const detail = axiosErr.response.data?.detail || JSON.stringify(axiosErr.response.data);
        throw new Error(`ML worker rejected file (${axiosErr.response.status}): ${detail}`);
      }
      throw axiosErr;
    }

   
    const rawResult = response.data;
    console.log(`📊 METRICS — loc: ${rawResult.features?.loc}, vg: ${rawResult.features?.['v(g)']}, branches: ${rawResult.features?.branchcount}, prob: ${rawResult.bug_probability}, risk: ${rawResult.risk_level}`);
    const mlResult  = calibrateRisk(rawResult); 
    console.log(`🔍 AFTER CAL — prob: ${mlResult.bug_probability}, risk: ${mlResult.risk_level}, applied: ${mlResult.calibration?.applied}`);// ← calibration apply
    console.log(`✅ ML worker responded for project ${projectId}`);
      if (mlResult.calibration?.applied) {
    console.log(`🔧 Calibration applied: ${mlResult.calibration.note}`);
    }

    const riskLevel = mlResult.risk_level === 'High' ? 'HIGH' :
                      mlResult.risk_level === 'Low' ? 'LOW' : 'MEDIUM';

    const predResult = await pool.query(
      `INSERT INTO predictions 
        (project_id, model_version, risk_score, risk_level, is_pro_report) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING prediction_id`,
      [projectId, 'v2.1', mlResult.bug_probability, riskLevel, false]
    );

    const predictionId = predResult.rows[0].prediction_id;
    console.log(`✅ Prediction saved: ${predictionId}`);

    const features = mlResult.features;
    // ✅ Batch inserts instead of sequential await in loop
    const metricInserts = Object.entries(features).map(([metricName, metricValue]) =>
      pool.query(
        `INSERT INTO code_metrics 
          (prediction_id, metric_name, metric_value, extraction_method) 
         VALUES ($1, $2, $3, $4)`,
        [predictionId, metricName, metricValue, 'radon']
      )
    );
    await Promise.all(metricInserts);
    console.log(`✅ Code metrics saved for prediction ${predictionId}`);

    const topFeatures = mlResult.shap_explanation?.top_features ?? [];
    const shapInserts = topFeatures.map((feat, i) =>
      pool.query(
        `INSERT INTO shap_explanations 
          (prediction_id, feature_name, feature_value, shap_value, 
           shap_base_value, feature_rank, is_top_5) 
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          predictionId,
          feat.feature,
          feat.metric_value,
          feat.shap_value,
          mlResult.shap_explanation.base_value,
          i + 1,
          true
        ]
      )
    );
    await Promise.all(shapInserts);
    console.log(`✅ SHAP explanations saved for prediction ${predictionId}`);

    await pool.query(
      `UPDATE projects 
       SET latest_prediction_id = $1, 
           analysis_count = analysis_count + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE project_id = $2`,
      [predictionId, projectId]
    );

    console.log(`✅ Analysis complete for project ${projectId}`);
    return { success: true, predictionId, riskLevel, bugProbability: mlResult.bug_probability };

  } catch (err) {
    console.error(`❌ Analysis failed for project ${projectId}:`, err.message);
    return { success: false, error: err.message };
  }
};

module.exports = { analyzeProject };
