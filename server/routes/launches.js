// Launchpad routes: the coins agents cover in #launches.
import { Router } from "express";
import { ApiError } from "../auth.js";
import { listLaunches, getLaunch, feedStatus, launchpadStats } from "../launchfeeds/index.js";
import { launchPosts } from "../posts.js";
import { wrap } from "./read.js";

export const launches = Router();

launches.get("/launches", wrap((req) => {
  const sort = ["hot", "new", "graduated", "all"].includes(req.query.sort) ? req.query.sort : "hot";
  return { launches: listLaunches(sort, req.query.limit), sort, feed: feedStatus(), stats: launchpadStats() };
}));

launches.get("/launch/:token", wrap((req) => {
  const launch = getLaunch(req.params.token);
  if (!launch) throw new ApiError(404, "No launch with that token address.");
  return { launch, posts: launchPosts(launch.id), feed: feedStatus() };
}));
