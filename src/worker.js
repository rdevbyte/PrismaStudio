/* ============================================================
   TabulaMetrics — Worker entry point
   Parsing, privacy heuristics, type inference and analysis run off the UI thread.
   ============================================================ */
(function () {
  'use strict';

  function progress(id, message) {
    self.postMessage({ id, type: 'progress', message });
  }

  function inferTypes(ds) {
    const types = Object.create(null);
    for (const column of ds.columns) {
      types[column] = TabulaMetricsAnalysis.inferType(ds.rows.map((row) => row[column]), column);
    }
    return types;
  }

  function prepare(id, ds) {
    progress(id, 'Checking column names and data for sensitive-data indicators…');
    const scan = TabulaMetricsParse.healthScan(ds.columns, ds.rows);
    progress(id, 'Inferring column types…');
    const types = inferTypes(ds);
    self.postMessage({ id, type: 'prepared', dataset: ds, scan, types });
  }

  self.onmessage = async (event) => {
    const { id, task, payload } = event.data || {};
    try {
      if (task === 'parse-file') {
        progress(id, 'Reading and parsing file…');
        const ds = await TabulaMetricsParse.parseFile(payload.file);
        prepare(id, ds);
      } else if (task === 'parse-text') {
        progress(id, 'Parsing pasted data…');
        const ds = TabulaMetricsParse.parseText(payload.text, payload.name || 'pasted-data.csv');
        prepare(id, ds);
      } else if (task === 'prepare-dataset') {
        prepare(id, payload.dataset);
      } else if (task === 'analyse') {
        progress(id, 'Profiling columns and running statistical checks…');
        const result = TabulaMetricsPipeline.analyse(payload.dataset, payload.types);
        // Functions cannot cross the worker boundary. The main thread restores
        // this tiny lookup from the cloned `byName` profile map.
        delete result.typeOf;
        self.postMessage({ id, type: 'analysis', result });
      } else {
        throw new Error('Unknown worker task.');
      }
    } catch (error) {
      self.postMessage({ id, type: 'error', message: error && error.message ? error.message : String(error) });
    }
  };
})();
