import { Request, Response, NextFunction } from 'express';

export const notFoundHandler = (req: Request, res: Response, next: NextFunction) => {
    const error = new Error(`Not Found - ${req.originalUrl}`);
    res.status(404);
    next(error);
};

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    const statusCode = err.status || err.statusCode || (res.statusCode === 200 ? 500 : res.statusCode);

    console.error('Error:', err.message);
    if (err.stack) {
        console.error(err.stack);
    }

    res.status(statusCode).json({
        error: statusCode === 500 ? 'Internal Server Error' : err.message,
        details: err.details,
        stack: process.env.NODE_ENV === 'production' ? 'stack suppressed' : err.stack,
    });
};
