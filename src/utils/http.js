export const httpError = (status, message) =>
  Object.assign(new Error(message), { status });

// Runs the handler and turns errors with a status into JSON answers
export const handle =
  (handler, successStatus = 200) =>
  async (req, res) => {
    try {
      res.status(successStatus).json(await handler(req));
    } catch (error) {
      if (!error.status)
        console.error(`[${req.method} ${req.originalUrl}]`, error);
      res.status(error.status || 500).json({
        error: error.status ? error.message : "Something went wrong",
      });
    }
  };
